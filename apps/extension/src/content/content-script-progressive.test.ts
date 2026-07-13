import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContentCommand } from "../shared/extension-messages.js";
import {
  initializeContentScript,
  type ContentRuntime,
  type ContentScriptInstance,
} from "./content-script.js";

class FakeRuntime implements ContentRuntime {
  readonly sent: ContentCommand[] = [];
  private readonly listeners = new Set<(message: unknown) => void>();

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => this.listeners.add(listener),
    removeListener: (listener: (message: unknown) => void) => this.listeners.delete(listener),
  };

  sendMessage(message: ContentCommand): Promise<unknown> {
    this.sent.push(message);
    return Promise.resolve({ handled: true });
  }

  emit(message: unknown): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

const instances: ContentScriptInstance[] = [];

function createInstance(runtime: FakeRuntime): ContentScriptInstance {
  let nextId = 0;
  const instance = initializeContentScript({
    createRequestId: () => `request-${(nextId += 1)}`,
    document,
    getAnchorRect: () => ({
      bottom: 120,
      height: 20,
      left: 80,
      right: 180,
      top: 100,
      width: 100,
    }),
    runtime,
  });
  instances.push(instance);
  return instance;
}

function selectAndTranslate(): void {
  const element = document.createElement("p");
  element.textContent = "investigation";
  document.body.append(element);
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  if (selection === null) {
    throw new Error("Selection API is unavailable.");
  }
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new MouseEvent("mouseup"));
  document
    .querySelector<HTMLElement>("[data-huayi-overlay-host]")
    ?.shadowRoot?.querySelector<HTMLButtonElement>("[data-action='translate']")
    ?.click();
}

function emitResult(runtime: FakeRuntime): void {
  runtime.emit({
    requestId: "request-1",
    result: {
      collocations: [],
      contextualMeaningZh: "调查",
      partOfSpeech: "noun",
      selectionKind: "word",
      similarTerms: [],
      sourceText: "investigation",
      type: "translate-lexical",
    },
    schemaVersion: 2,
    type: "result",
  });
}

async function acknowledgeAnalysis(): Promise<void> {
  await Promise.resolve();
}

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.destroy();
  }
  window.getSelection()?.removeAllRanges();
  document.body.textContent = "";
  vi.useRealTimers();
});

describe("content-script progressive event routing", () => {
  it.each([
    ["query before result", true, "present"],
    ["result before query", false, "absent"],
  ] as const)("routes mixed updates and status when %s", async (_label, queryFirst, presence) => {
    vi.useFakeTimers();
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const appendUpdate = vi.spyOn(instance.controller, "appendUpdate");
    selectAndTranslate();
    await acknowledgeAnalysis();

    runtime.emit({
      delta: "调",
      requestId: "request-1",
      schemaVersion: 2,
      section: "contextual-meaning",
      sequence: 0,
      type: "analysis-delta",
    });
    if (queryFirst) {
      runtime.emit({
        presence,
        requestId: "request-2",
        schemaVersion: 2,
        type: "word-status",
      });
      vi.advanceTimersByTime(40);
      expect(instance.controller.state).toMatchObject({
        status: "streaming",
        wordbook: { availability: presence },
      });
    }

    runtime.emit({
      requestId: "request-1",
      schemaVersion: 2,
      section: "part-of-speech",
      sequence: 1,
      type: "analysis-section",
      value: "noun",
    });
    expect(appendUpdate.mock.calls.map(([event]) => event.type)).toEqual([
      "analysis-delta",
      "analysis-section",
    ]);

    emitResult(runtime);
    expect(instance.controller.state).toMatchObject({
      status: "result",
      wordbook: { availability: queryFirst ? presence : "checking" },
    });
    if (!queryFirst) {
      runtime.emit({
        presence,
        requestId: "request-2",
        schemaVersion: 2,
        type: "word-status",
      });
      expect(instance.controller.state).toMatchObject({
        status: "result",
        wordbook: { availability: presence },
      });
    }
  });

  it("fails a gapped analysis update once and ignores its late update and terminal", async () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    selectAndTranslate();
    await acknowledgeAnalysis();

    runtime.emit({
      requestId: "request-1",
      schemaVersion: 2,
      section: "part-of-speech",
      sequence: 1,
      type: "analysis-section",
      value: "noun",
    });

    expect(instance.controller.state).toMatchObject({
      error: { code: "INVALID_RESPONSE" },
      status: "error",
    });
    expect(runtime.sent.filter((command) => command.type === "CANCEL_REQUEST")).toEqual([
      { requestId: "request-1", type: "CANCEL_REQUEST" },
    ]);
    const stateAfterGap = instance.controller.state;

    runtime.emit({
      delta: "late",
      requestId: "request-1",
      schemaVersion: 2,
      section: "contextual-meaning",
      sequence: 0,
      type: "analysis-delta",
    });
    emitResult(runtime);

    expect(instance.controller.state).toEqual(stateAfterGap);
    expect(runtime.sent.filter((command) => command.type === "CANCEL_REQUEST")).toHaveLength(1);
  });
});

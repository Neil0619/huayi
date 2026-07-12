import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContentCommand } from "../shared/extension-messages.js";
import {
  initializeContentScript,
  type ContentRuntime,
  type ContentScriptInstance,
} from "./content-script.js";

class FakeRuntime implements ContentRuntime {
  readonly sent: ContentCommand[] = [];
  private readonly deliveries: Promise<unknown>[] = [];
  private readonly listeners = new Set<(message: unknown) => void>();

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => this.listeners.add(listener),
    removeListener: (listener: (message: unknown) => void) => this.listeners.delete(listener),
  };

  enqueueDelivery(delivery: Promise<unknown>): void {
    this.deliveries.push(delivery);
  }

  sendMessage(message: ContentCommand): Promise<unknown> {
    this.sent.push(message);
    return this.deliveries.shift() ?? Promise.resolve({ handled: true });
  }

  emit(message: unknown): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

const instances: ContentScriptInstance[] = [];

const lexicalResult = {
  collocations: [
    { meaningZh: "刑事调查", text: "criminal investigation" },
    { meaningZh: "展开调查", text: "launch an investigation" },
  ],
  contextualMeaningZh: "调查",
  partOfSpeech: "noun",
  selectionKind: "word",
  similarTerms: [
    { meaningZh: "询问", partOfSpeech: "noun", text: "inquiry" },
    { meaningZh: "审查", partOfSpeech: "noun", text: "examination" },
    { meaningZh: "研究", partOfSpeech: "noun", text: "research" },
  ],
  sourceText: "investigation",
  type: "translate-lexical",
} as const;

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

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

function selectText(text: string): HTMLElement {
  const element = document.createElement("p");
  element.textContent = text;
  document.body.append(element);
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  if (selection === null) {
    throw new Error("Selection API is unavailable.");
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return element;
}

function chooseTranslation(): void {
  document.dispatchEvent(new MouseEvent("mouseup"));
  document
    .querySelector<HTMLElement>("[data-huayi-overlay-host]")
    ?.shadowRoot?.querySelector<HTMLButtonElement>("[data-action='translate']")
    ?.click();
}

function emitResult(runtime: FakeRuntime, requestId = "request-1"): void {
  runtime.emit({
    requestId,
    result: lexicalResult,
    schemaVersion: 1,
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

describe("content-script concurrent operations", () => {
  it("sends analysis before a separately identified wordbook check", async () => {
    const runtime = new FakeRuntime();
    createInstance(runtime);
    selectText("investigation");

    chooseTranslation();
    expect(runtime.sent.map((command) => command.type)).toEqual(["ANALYZE_SELECTION"]);
    await acknowledgeAnalysis();

    expect(runtime.sent.map((command) => command.type)).toEqual([
      "ANALYZE_SELECTION",
      "CHECK_WORD_IN_EUDIC",
    ]);
    expect(runtime.sent).toMatchObject([
      { request: { requestId: "request-1" } },
      { request: { requestId: "request-2", word: "investigation" } },
    ]);
  });

  it("does not query wordbook status for a phrase", async () => {
    const runtime = new FakeRuntime();
    createInstance(runtime);
    selectText("sustained heatwave");

    chooseTranslation();
    await acknowledgeAnalysis();

    expect(runtime.sent.map((command) => command.type)).toEqual(["ANALYZE_SELECTION"]);
  });

  it.each([
    ["query before result", true, "present"],
    ["result before query", false, "absent"],
  ] as const)("routes deltas and status when %s", async (_label, queryFirst, presence) => {
    vi.useFakeTimers();
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    selectText("investigation");
    chooseTranslation();
    await acknowledgeAnalysis();

    runtime.emit({
      delta: "调",
      requestId: "request-1",
      schemaVersion: 1,
      section: "contextual-meaning",
      sequence: 0,
      type: "analysis-delta",
    });
    if (queryFirst) {
      runtime.emit({
        presence,
        requestId: "request-2",
        schemaVersion: 1,
        type: "word-status",
      });
      vi.advanceTimersByTime(40);
      expect(instance.controller.state).toMatchObject({
        status: "streaming",
        wordbook: { availability: presence },
      });
    }

    emitResult(runtime);
    expect(instance.controller.state).toMatchObject({
      status: "result",
      wordbook: { availability: queryFirst ? presence : "checking" },
    });
    if (!queryFirst) {
      runtime.emit({
        presence,
        requestId: "request-2",
        schemaVersion: 1,
        type: "word-status",
      });
      expect(instance.controller.state).toMatchObject({
        status: "result",
        wordbook: { availability: presence },
      });
    }
  });

  it("cancels a pending check before starting an explicit add", async () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    selectText("investigation");
    chooseTranslation();
    await acknowledgeAnalysis();
    emitResult(runtime);

    instance.controller.addWord();

    expect(runtime.sent.slice(-2)).toEqual([
      { requestId: "request-2", type: "CANCEL_REQUEST" },
      {
        request: {
          context: "investigation",
          language: "en",
          requestId: "request-3",
          schemaVersion: 1,
          type: "add-word",
          word: "investigation",
        },
        type: "ADD_WORD_TO_EUDIC",
      },
    ]);
    runtime.emit({
      error: { code: "NETWORK_ERROR", message: "添加失败。", retryable: true },
      requestId: "request-3",
      schemaVersion: 1,
      type: "error",
    });
    expect(instance.controller.state).toMatchObject({
      status: "result",
      wordbook: { mutation: { error: { code: "NETWORK_ERROR" }, status: "error" } },
    });
  });

  it.each(["close", "Escape", "new selection"] as const)(
    "cancels every active ID exactly once on %s",
    async (trigger) => {
      const runtime = new FakeRuntime();
      const instance = createInstance(runtime);
      selectText("investigation");
      chooseTranslation();
      await acknowledgeAnalysis();

      if (trigger === "close") {
        instance.controller.close();
        instance.controller.close();
      } else if (trigger === "Escape") {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));
      } else {
        selectText("replacement");
        document.dispatchEvent(new MouseEvent("mouseup"));
      }

      expect(runtime.sent.filter((command) => command.type === "CANCEL_REQUEST")).toEqual([
        { requestId: "request-1", type: "CANCEL_REQUEST" },
        { requestId: "request-2", type: "CANCEL_REQUEST" },
      ]);
    },
  );

  it("does not start a stale check after close while the analysis acknowledgement is held", async () => {
    const runtime = new FakeRuntime();
    const acknowledgement = deferred<{ handled: boolean }>();
    runtime.enqueueDelivery(acknowledgement.promise);
    const instance = createInstance(runtime);
    selectText("investigation");
    chooseTranslation();

    instance.controller.close();
    acknowledgement.resolve({ handled: true });
    await acknowledgeAnalysis();

    expect(runtime.sent).toEqual([
      expect.objectContaining({ type: "ANALYZE_SELECTION" }),
      { requestId: "request-1", type: "CANCEL_REQUEST" },
    ]);
  });

  it("routes analysis and check errors without surfacing a passive check error", async () => {
    vi.useFakeTimers();
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    selectText("investigation");
    chooseTranslation();
    await acknowledgeAnalysis();
    runtime.emit({
      delta: "部分",
      requestId: "request-1",
      schemaVersion: 1,
      section: "translation",
      sequence: 0,
      type: "analysis-delta",
    });
    vi.advanceTimersByTime(40);

    runtime.emit({
      error: { code: "NETWORK_ERROR", message: "欧路查询失败。", retryable: true },
      requestId: "request-2",
      schemaVersion: 1,
      type: "error",
    });
    expect(instance.controller.state).toMatchObject({
      status: "streaming",
      wordbook: { availability: "unknown" },
    });

    runtime.emit({
      error: { code: "TIMEOUT", message: "分析超时。", retryable: true },
      requestId: "request-1",
      schemaVersion: 1,
      type: "error",
    });
    expect(instance.controller.state).toMatchObject({
      error: { code: "TIMEOUT" },
      preview: { sections: { translation: "部分" } },
      status: "error",
      wordbook: { availability: "unknown" },
    });
  });

  it("starts a fresh analysis and check pair on retry", async () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    selectText("investigation");
    chooseTranslation();
    await acknowledgeAnalysis();
    runtime.emit({
      error: { code: "TIMEOUT", message: "分析超时。", retryable: true },
      requestId: "request-1",
      schemaVersion: 1,
      type: "error",
    });

    instance.controller.retry();
    await acknowledgeAnalysis();

    expect(runtime.sent.slice(2).map((command) => command.type)).toEqual([
      "CANCEL_REQUEST",
      "ANALYZE_SELECTION",
      "CHECK_WORD_IN_EUDIC",
    ]);
    expect(runtime.sent.slice(2)).toMatchObject([
      { requestId: "request-2" },
      { request: { requestId: "request-3" } },
      { request: { requestId: "request-4" } },
    ]);
    expect(instance.controller.state).toMatchObject({
      status: "loading",
      wordbook: { availability: "checking" },
    });
  });
});

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
    if (message.type === "WARMUP_HOST") {
      return Promise.resolve({ handled: true });
    }
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
  commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
  commonPhrases: [
    { meaningZh: "刑事调查", text: "criminal investigation" },
    { meaningZh: "展开调查", text: "launch an investigation" },
  ],
  confusableWords: [],
  contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
  dictionaryForm: "investigation",
  selectionKind: "word",
  sourceText: "investigation",
  type: "translate-word",
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

function selectText(text: string, selectedText = text): HTMLElement {
  const element = document.createElement("p");
  element.textContent = text;
  document.body.append(element);
  const node = element.firstChild;
  if (!(node instanceof Text)) {
    throw new Error("Expected text fixture.");
  }
  const start = node.data.indexOf(selectedText);
  if (start < 0) {
    throw new Error("Selected text was not found in the fixture.");
  }
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + selectedText.length);
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
    schemaVersion: 5,
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
    expect(runtime.sent.map((command) => command.type)).toEqual([
      "WARMUP_HOST",
      "ANALYZE_SELECTION",
    ]);
    await acknowledgeAnalysis();

    expect(runtime.sent.map((command) => command.type)).toEqual([
      "WARMUP_HOST",
      "ANALYZE_SELECTION",
      "CHECK_WORD_IN_EUDIC",
    ]);
    expect(runtime.sent).toMatchObject([
      { type: "WARMUP_HOST" },
      { request: { requestId: "request-1" } },
      { request: { requestId: "request-2", word: "investigation" } },
    ]);
  });

  it("sends sentence context for a phrase without exposing a wordbook action", async () => {
    const runtime = new FakeRuntime();
    createInstance(runtime);
    selectText("A sustained heatwave affected the region.", "sustained heatwave");

    chooseTranslation();
    expect(runtime.sent[1]).toMatchObject({
      request: {
        selection: "sustained heatwave",
        sentenceContext: "A sustained heatwave affected the region.",
      },
      type: "ANALYZE_SELECTION",
    });
    await acknowledgeAnalysis();

    runtime.emit({
      requestId: "request-1",
      result: {
        ...lexicalResult,
        selectionKind: "phrase",
        sourceText: "sustained heatwave",
      },
      schemaVersion: 5,
      type: "result",
    });

    expect(runtime.sent.map((command) => command.type)).toEqual([
      "WARMUP_HOST",
      "ANALYZE_SELECTION",
    ]);
    expect(
      document
        .querySelector<HTMLElement>("[data-huayi-overlay-host]")
        ?.shadowRoot?.querySelector("[data-action='add-word']"),
    ).toBeNull();
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
          schemaVersion: 5,
          type: "add-word",
          word: "investigation",
        },
        type: "ADD_WORD_TO_EUDIC",
      },
    ]);
    runtime.emit({
      error: { code: "NETWORK_ERROR", message: "添加失败。", retryable: true },
      requestId: "request-3",
      schemaVersion: 5,
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
      { type: "WARMUP_HOST" },
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
      schemaVersion: 5,
      section: "translation",
      sequence: 0,
      type: "analysis-delta",
    });
    vi.advanceTimersByTime(40);

    runtime.emit({
      error: { code: "NETWORK_ERROR", message: "欧路查询失败。", retryable: true },
      requestId: "request-2",
      schemaVersion: 5,
      type: "error",
    });
    expect(instance.controller.state).toMatchObject({
      status: "streaming",
      wordbook: { availability: "unknown" },
    });

    runtime.emit({
      error: { code: "TIMEOUT", message: "分析超时。", retryable: true },
      requestId: "request-1",
      schemaVersion: 5,
      type: "error",
    });
    expect(instance.controller.state).toMatchObject({
      error: { code: "TIMEOUT" },
      preview: { text: { translation: "部分" } },
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
      schemaVersion: 5,
      type: "error",
    });

    instance.controller.retry();
    await acknowledgeAnalysis();

    const nonWarmupCommands = runtime.sent.filter((command) => command.type !== "WARMUP_HOST");
    expect(nonWarmupCommands.slice(2).map((command) => command.type)).toEqual([
      "CANCEL_REQUEST",
      "ANALYZE_SELECTION",
      "CHECK_WORD_IN_EUDIC",
    ]);
    expect(nonWarmupCommands.slice(2)).toMatchObject([
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

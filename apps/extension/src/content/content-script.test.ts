import { afterEach, describe, expect, it } from "vitest";

import type { ContentCommand } from "../shared/extension-messages.js";
import {
  createAddWordRequest,
  createAnalyzeRequest,
  createCheckWordRequest,
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

  sendMessage(message: ContentCommand): undefined {
    this.sent.push(message);
    return undefined;
  }

  emit(message: unknown): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

const instances: ContentScriptInstance[] = [];

function selectContents(element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  if (selection === null) {
    throw new Error("Selection API is unavailable.");
  }
  selection.removeAllRanges();
  selection.addRange(range);
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

function resolveWordTranslation(runtime: FakeRuntime, requestId: string, sourceText: string): void {
  runtime.emit({
    requestId,
    result: {
      collocations: [
        { meaningZh: "测试搭配一", text: "sample collocation" },
        { meaningZh: "测试搭配二", text: "common collocation" },
      ],
      contextualMeaningZh: "测试词义",
      partOfSpeech: "noun",
      selectionKind: "word",
      similarTerms: [
        { meaningZh: "相似项一", partOfSpeech: "noun", text: "alternative" },
        { meaningZh: "相似项二", partOfSpeech: "noun", text: "equivalent" },
        { meaningZh: "相似项三", partOfSpeech: "noun", text: "counterpart" },
      ],
      sourceText,
      type: "translate-lexical",
    },
    schemaVersion: 2,
    type: "result",
  });
}

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.destroy();
  }
  window.getSelection()?.removeAllRanges();
  document.body.textContent = "";
});

describe("createAnalyzeRequest", () => {
  it("creates a versioned protocol request without page metadata", () => {
    expect(
      createAnalyzeRequest(
        {
          context: "The investigation was in its early stages.",
          selection: "investigation",
          selectionKind: "word",
          sentenceContext: "The investigation was in its early stages.",
          wordbookContext: "The investigation was in its early stages.",
        },
        "translate",
        "request-1",
      ),
    ).toEqual({
      action: "translate",
      context: "The investigation was in its early stages.",
      requestId: "request-1",
      schemaVersion: 2,
      selection: "investigation",
      selectionKind: "word",
      sentenceContext: "The investigation was in its early stages.",
      targetLanguage: "zh-CN",
      type: "analyze",
    });
  });

  it("refuses paragraph explanation", () => {
    expect(() =>
      createAnalyzeRequest(
        {
          context: "First sentence. Second sentence.",
          selection: "First sentence. Second sentence.",
          selectionKind: "paragraph",
          sentenceContext: null,
          wordbookContext: null,
        },
        "explain",
        "request-2",
      ),
    ).toThrow();
  });
});

describe("createAddWordRequest", () => {
  it("uses only the original selected word and extracted sentence", () => {
    expect(
      createAddWordRequest(
        {
          context: "A wider paragraph that is not sent.",
          selection: "investigation",
          selectionKind: "word",
          sentenceContext: "The investigation was in its early stages.",
          wordbookContext: "The investigation was in its early stages.",
        },
        "word-1",
      ),
    ).toEqual({
      context: "The investigation was in its early stages.",
      language: "en",
      requestId: "word-1",
      schemaVersion: 2,
      type: "add-word",
      word: "investigation",
    });
  });

  it("rejects non-word selections", () => {
    expect(() =>
      createAddWordRequest(
        {
          context: "sustained heatwave",
          selection: "sustained heatwave",
          selectionKind: "phrase",
          sentenceContext: "A sustained heatwave affected the region.",
          wordbookContext: null,
        },
        "word-2",
      ),
    ).toThrow();
  });
});

describe("createCheckWordRequest", () => {
  it("uses only the original word and omits context and model text", () => {
    expect(
      createCheckWordRequest(
        {
          context: "A wider paragraph that must not be sent.",
          selection: "investigation",
          selectionKind: "word",
          sentenceContext: "The investigation continues.",
          wordbookContext: "The investigation continues.",
        },
        "check-1",
      ),
    ).toEqual({
      language: "en",
      requestId: "check-1",
      schemaVersion: 2,
      type: "check-word",
      word: "investigation",
    });
  });
});

describe("initializeContentScript", () => {
  it("opens actions on mouse selection and renders the matching result", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const paragraph = document.createElement("p");
    paragraph.textContent = "The investigation was in its early stages.";
    document.body.append(paragraph);
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected text fixture.");
    }
    const range = document.createRange();
    const start = text.data.indexOf("investigation");
    range.setStart(text, start);
    range.setEnd(text, start + "investigation".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(runtime.sent).toEqual([{ type: "WARMUP_HOST" }]);
    instance.controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-action='translate']")
      ?.click();

    expect(runtime.sent[1]).toMatchObject({
      request: {
        requestId: "request-1",
        selection: "investigation",
        sentenceContext: "The investigation was in its early stages.",
      },
      type: "ANALYZE_SELECTION",
    });

    runtime.emit({
      requestId: "request-1",
      result: {
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
      },
      schemaVersion: 2,
      type: "result",
    });
    instance.controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-action='add-word']")
      ?.click();
    expect(runtime.sent[2]).toEqual({
      request: {
        context: "The investigation was in its early stages.",
        language: "en",
        requestId: "request-2",
        schemaVersion: 2,
        type: "add-word",
        word: "investigation",
      },
      type: "ADD_WORD_TO_EUDIC",
    });
    runtime.emit({
      outcome: "added",
      requestId: "request-2",
      schemaVersion: 2,
      type: "word-added",
    });
    expect(instance.controller.shadowRoot.textContent).toContain("已加入生词本");
  });

  it("cancels the active request when a new selection replaces it", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const first = document.createElement("p");
    first.textContent = "investigation";
    const second = document.createElement("p");
    second.textContent = "sustained heatwave";
    document.body.append(first, second);

    selectContents(first);
    document.dispatchEvent(new MouseEvent("mouseup"));
    instance.controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-action='translate']")
      ?.click();

    selectContents(second);
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(runtime.sent.filter((command) => command.type === "CANCEL_REQUEST")).toEqual([
      { requestId: "request-1", type: "CANCEL_REQUEST" },
    ]);
    expect(instance.controller.state).toMatchObject({
      selection: { selection: "sustained heatwave" },
      status: "actions",
    });
  });

  it("cancels a pending wordbook request on a new selection and ignores its late success", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const first = document.createElement("p");
    first.textContent = "investigation";
    const second = document.createElement("p");
    second.textContent = "replacement";
    document.body.append(first, second);

    selectContents(first);
    document.dispatchEvent(new MouseEvent("mouseup"));
    instance.controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-action='translate']")
      ?.click();
    resolveWordTranslation(runtime, "request-1", "investigation");
    instance.controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-action='add-word']")
      ?.click();

    selectContents(second);
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(runtime.sent.filter((command) => command.type === "CANCEL_REQUEST")).toEqual([
      { requestId: "request-2", type: "CANCEL_REQUEST" },
    ]);
    expect(instance.controller.state).toMatchObject({
      selection: { selection: "replacement" },
      status: "actions",
    });
    runtime.emit({
      outcome: "added",
      requestId: "request-2",
      schemaVersion: 2,
      type: "word-added",
    });
    expect(instance.controller.state).toMatchObject({
      selection: { selection: "replacement" },
      status: "actions",
    });
  });

  it("cancels a pending wordbook request when Escape closes the result", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const paragraph = document.createElement("p");
    paragraph.textContent = "investigation";
    document.body.append(paragraph);
    selectContents(paragraph);
    document.dispatchEvent(new MouseEvent("mouseup"));
    instance.controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-action='translate']")
      ?.click();
    resolveWordTranslation(runtime, "request-1", "investigation");
    instance.controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-action='add-word']")
      ?.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));

    expect(instance.controller.state.status).toBe("closed");
    expect(runtime.sent.at(-1)).toEqual({ requestId: "request-2", type: "CANCEL_REQUEST" });
  });

  it("does not reopen the selected text when Escape keyup follows closing", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const paragraph = document.createElement("p");
    paragraph.textContent = "investigation";
    document.body.append(paragraph);
    selectContents(paragraph);
    document.dispatchEvent(new MouseEvent("mouseup"));
    instance.controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-action='translate']")
      ?.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));

    expect(instance.controller.state.status).toBe("closed");
    expect(runtime.sent.at(-1)).toEqual({ requestId: "request-1", type: "CANCEL_REQUEST" });
  });
});

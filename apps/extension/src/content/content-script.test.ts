import { afterEach, describe, expect, it } from "vitest";

import type { ContentCommand } from "../shared/extension-messages.js";
import { DEFAULT_EXTENSION_SETTINGS, type ExtensionSettings } from "../settings/settings-domain.js";
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

function createParagraph(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  document.body.append(paragraph);
  return paragraph;
}

function clickAction(instance: ContentScriptInstance, action: "add-word" | "translate"): void {
  instance.controller.shadowRoot
    .querySelector<HTMLButtonElement>(`[data-action='${action}']`)
    ?.click();
}

function createInstance(
  runtime: FakeRuntime,
  settings: ExtensionSettings = DEFAULT_EXTENSION_SETTINGS,
): ContentScriptInstance {
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
    settings,
  });
  instances.push(instance);
  return instance;
}

function resolveWordTranslation(runtime: FakeRuntime, requestId: string, sourceText: string): void {
  runtime.emit({
    requestId,
    result: {
      commonMeanings: [{ meaningsZh: ["测试词义"], partOfSpeech: "noun" }],
      commonPhrases: [
        { meaningZh: "测试搭配一", text: "sample collocation" },
        { meaningZh: "测试搭配二", text: "common collocation" },
      ],
      confusableWords: [],
      contextualSense: { meaningZh: "测试词义", partOfSpeech: "noun" },
      dictionaryForm: sourceText,
      selectionKind: "word",
      sourceText,
      type: "translate-word",
    },
    schemaVersion: 7,
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
      schemaVersion: 7,
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

describe("configured selection behavior", () => {
  it("starts a supported configured action immediately", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime, {
      ...DEFAULT_EXTENSION_SETTINGS,
      defaultAction: "translate",
    });
    const paragraph = createParagraph("investigation");
    selectContents(paragraph);
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(instance.controller.state.status).toBe("loading");
    expect(runtime.sent).toEqual([
      expect.objectContaining({ request: expect.objectContaining({ action: "translate" }) }),
      { type: "WARMUP_HOST" },
    ]);
  });

  it("does not initialize selection behavior when the product is disabled", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime, {
      ...DEFAULT_EXTENSION_SETTINGS,
      enabled: false,
    });
    const paragraph = createParagraph("The investigation continues.");
    selectContents(paragraph);
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(instance.controller.state.status).toBe("idle");
    expect(runtime.sent).toEqual([]);
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
      schemaVersion: 7,
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
      schemaVersion: 7,
      type: "check-word",
      word: "investigation",
    });
  });
});

describe("initializeContentScript", () => {
  it("centers a mouse selection overlay on the release position", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const paragraph = createParagraph("investigation");
    selectContents(paragraph);

    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 320, clientY: 110, detail: 1 }));

    expect(instance.controller.state).toMatchObject({
      anchorRect: {
        bottom: 120,
        height: 20,
        left: 320,
        right: 320,
        top: 100,
        width: 0,
      },
      status: "actions",
    });
    expect(
      instance.controller.shadowRoot.querySelector<HTMLElement>(".huayi-root")?.style.left,
    ).toBe("230px");
  });

  it("opens actions on mouse selection and renders the matching result", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const paragraph = createParagraph("The investigation was in its early stages.");
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
    clickAction(instance, "translate");

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
      },
      schemaVersion: 7,
      type: "result",
    });
    clickAction(instance, "add-word");
    expect(runtime.sent[2]).toEqual({
      request: {
        context: "The investigation was in its early stages.",
        language: "en",
        requestId: "request-2",
        schemaVersion: 7,
        type: "add-word",
        word: "investigation",
      },
      type: "ADD_WORD_TO_EUDIC",
    });
    runtime.emit({
      outcome: "added",
      requestId: "request-2",
      schemaVersion: 7,
      type: "word-added",
    });
    expect(instance.controller.shadowRoot.textContent).toContain("已加入");
  });

  it("cancels the active request when a new selection replaces it", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const first = createParagraph("investigation");
    const second = createParagraph("sustained heatwave");

    selectContents(first);
    document.dispatchEvent(new MouseEvent("mouseup"));
    clickAction(instance, "translate");

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

  it("keeps a pending wordbook request on a new selection and ignores its late success", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const first = createParagraph("investigation");
    const second = createParagraph("replacement");

    selectContents(first);
    document.dispatchEvent(new MouseEvent("mouseup"));
    clickAction(instance, "translate");
    resolveWordTranslation(runtime, "request-1", "investigation");
    clickAction(instance, "add-word");

    selectContents(second);
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(runtime.sent.filter((command) => command.type === "CANCEL_REQUEST")).toEqual([]);
    expect(instance.controller.state).toMatchObject({
      selection: { selection: "replacement" },
      status: "actions",
    });
    runtime.emit({
      outcome: "added",
      requestId: "request-2",
      schemaVersion: 7,
      type: "word-added",
    });
    expect(instance.controller.state).toMatchObject({
      selection: { selection: "replacement" },
      status: "actions",
    });
  });

  it("keeps a pending wordbook request when Escape closes the result", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const paragraph = createParagraph("investigation");
    selectContents(paragraph);
    document.dispatchEvent(new MouseEvent("mouseup"));
    clickAction(instance, "translate");
    resolveWordTranslation(runtime, "request-1", "investigation");
    clickAction(instance, "add-word");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));

    expect(instance.controller.state.status).toBe("closed");
    expect(runtime.sent.filter((command) => command.type === "CANCEL_REQUEST")).toEqual([]);
    runtime.emit({
      outcome: "added",
      requestId: "request-2",
      schemaVersion: 7,
      type: "word-added",
    });
    expect(instance.controller.state.status).toBe("closed");
  });

  it("does not reopen the selected text when Escape keyup follows closing", () => {
    const runtime = new FakeRuntime();
    const instance = createInstance(runtime);
    const paragraph = createParagraph("investigation");
    selectContents(paragraph);
    document.dispatchEvent(new MouseEvent("mouseup"));
    clickAction(instance, "translate");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));

    expect(instance.controller.state.status).toBe("closed");
    expect(runtime.sent.at(-1)).toEqual({ requestId: "request-1", type: "CANCEL_REQUEST" });
  });
});

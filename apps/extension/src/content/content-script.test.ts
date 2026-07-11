import { afterEach, describe, expect, it } from "vitest";

import type { ContentCommand } from "../shared/extension-messages.js";
import {
  createAnalyzeRequest,
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
        },
        "translate",
        "request-1",
      ),
    ).toEqual({
      action: "translate",
      context: "The investigation was in its early stages.",
      requestId: "request-1",
      schemaVersion: 1,
      selection: "investigation",
      selectionKind: "word",
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
        },
        "explain",
        "request-2",
      ),
    ).toThrow();
  });
});

describe("initializeContentScript", () => {
  it("opens actions on mouse selection and renders the matching result", () => {
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

    expect(runtime.sent[0]).toMatchObject({
      request: { requestId: "request-1", selection: "investigation" },
      type: "ANALYZE_SELECTION",
    });

    runtime.emit({
      requestId: "request-1",
      result: {
        selectionKind: "sentence",
        sourceText: "It is ready.",
        translationZh: "它已准备就绪。",
        type: "translate-passage",
      },
      schemaVersion: 1,
      type: "result",
    });
    expect(instance.controller.shadowRoot.textContent).toContain("它已准备就绪");
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

    expect(runtime.sent[1]).toEqual({ requestId: "request-1", type: "CANCEL_ANALYSIS" });
    expect(instance.controller.state).toMatchObject({
      selection: { selection: "sustained heatwave" },
      status: "actions",
    });
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
    expect(runtime.sent.at(-1)).toEqual({ requestId: "request-1", type: "CANCEL_ANALYSIS" });
  });
});

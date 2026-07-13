import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult, AnalyzeAction } from "@huayi/protocol";

import { OverlayController } from "./overlay-controller.js";

const anchorRect = {
  bottom: 120,
  height: 20,
  left: 80,
  right: 180,
  top: 100,
  width: 100,
};

const selection = {
  context: "The investigation was in its early stages.",
  selection: "investigation",
  selectionKind: "word",
  wordbookContext: "The investigation was in its early stages.",
} as const;

const lexicalResult: AnalysisResult = {
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
};

const controllers: OverlayController[] = [];

function createController(
  actions: AnalyzeAction[],
  cancellations: number[],
  wordbookSelections: string[] = [],
) {
  const controller = new OverlayController({
    onAddWord: (selected) => wordbookSelections.push(selected.selection),
    onAnalyze: (action) => actions.push(action),
    onCancel: () => cancellations.push(1),
  });
  controllers.push(controller);
  return controller;
}

afterEach(() => {
  for (const controller of controllers.splice(0)) {
    controller.destroy();
  }
  document.body.textContent = "";
  vi.useRealTimers();
});

describe("OverlayController", () => {
  it("renders actions and enters loading after an action", () => {
    const actions: AnalyzeAction[] = [];
    const controller = createController(actions, []);
    controller.show(selection, anchorRect);

    const translate = controller.shadowRoot.querySelector<HTMLButtonElement>(
      "[data-action='translate']",
    );
    const explain = controller.shadowRoot.querySelector("[data-action='explain']");
    expect(translate).not.toBeNull();
    expect(explain).not.toBeNull();

    translate?.click();

    expect(actions).toEqual(["translate"]);
    expect(controller.state.status).toBe("loading");
    expect(controller.shadowRoot.textContent).toContain("正在翻译");
  });

  it("offers only translation for a paragraph", () => {
    const controller = createController([], []);
    controller.show(
      {
        context: "First sentence. Second sentence.",
        selection: "First sentence. Second sentence.",
        selectionKind: "paragraph",
        wordbookContext: null,
      },
      anchorRect,
    );

    expect(controller.shadowRoot.querySelector("[data-action='translate']")).not.toBeNull();
    expect(controller.shadowRoot.querySelector("[data-action='explain']")).toBeNull();
  });

  it("renders model markup as inert text", () => {
    const controller = createController([], []);
    controller.show(selection, anchorRect);
    controller.start("translate");
    controller.resolve({
      selectionKind: "sentence",
      sourceText: "Unsafe text.",
      translationZh: '<img src=x onerror="alert(1)">',
      type: "translate-passage",
    });

    expect(controller.shadowRoot.querySelector("img")).toBeNull();
    expect(controller.shadowRoot.textContent).toContain("<img src=x");
  });

  it("cancels a loading request when Escape closes the overlay", () => {
    const cancellations: number[] = [];
    const controller = createController([], cancellations);
    controller.show(selection, anchorRect);
    controller.start("translate");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(controller.state.status).toBe("closed");
    expect(cancellations).toHaveLength(1);
  });

  it("supports keyboard dragging while keeping position in the state machine", () => {
    const controller = createController([], []);
    controller.show(selection, anchorRect);
    controller.start("translate");
    controller.resolve({
      selectionKind: "sentence",
      sourceText: "It is ready.",
      translationZh: "它已准备就绪。",
      type: "translate-passage",
    });

    const handle = controller.shadowRoot.querySelector<HTMLButtonElement>("[data-drag-handle]");
    handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));

    expect(controller.state).toMatchObject({ position: { left: 90, top: 128 } });
  });

  it("adds a word once, preserves the result on error, and cancels saving on close", () => {
    const cancellations: number[] = [];
    const additions: string[] = [];
    const controller = createController([], cancellations, additions);
    controller.show(selection, anchorRect);
    controller.start("translate");
    controller.resolve(lexicalResult);

    const button = controller.shadowRoot.querySelector<HTMLButtonElement>(
      "[data-action='add-word']",
    );
    const body = controller.shadowRoot.querySelector<HTMLElement>(".huayi-body");
    if (body !== null) {
      body.scrollTop = 42;
    }
    button?.focus();
    button?.click();
    controller.shadowRoot.querySelector<HTMLButtonElement>("[data-action='add-word']")?.click();
    expect(additions).toEqual(["investigation"]);
    expect(controller.shadowRoot.textContent).toContain("正在添加");
    expect(controller.shadowRoot.querySelector<HTMLElement>(".huayi-body")?.scrollTop).toBe(42);
    expect((controller.shadowRoot.activeElement as HTMLElement | null)?.className).toBe(
      "huayi-wordbook",
    );

    controller.rejectWordbook({
      code: "NETWORK_ERROR",
      message: "网络连接失败，请重试。",
      retryable: true,
    });
    expect(controller.shadowRoot.textContent).toContain("语境义");
    expect(controller.shadowRoot.textContent).toContain("网络连接失败");
    expect((controller.shadowRoot.activeElement as HTMLElement | null)?.dataset.action).toBe(
      "add-word",
    );

    controller.addWord();
    controller.close();
    expect(cancellations).toHaveLength(1);
  });

  it("batches ten rapid deltas into one render after 40 milliseconds", () => {
    vi.useFakeTimers();
    const controller = createController([], []);
    controller.show(selection, anchorRect);
    controller.start("translate");
    const renderSpy = vi.spyOn(controller.shadowRoot, "replaceChildren");

    for (let sequence = 0; sequence < 10; sequence += 1) {
      controller.appendDelta({
        delta: `${sequence}`,
        requestId: "analysis-1",
        schemaVersion: 2,
        section: "contextual-meaning",
        sequence,
        type: "analysis-delta",
      });
    }

    expect(controller.state.status).toBe("loading");
    expect(renderSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(39);
    expect(renderSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(controller.state).toMatchObject({
      preview: {
        lastSequence: 9,
        sections: { "contextual-meaning": "0123456789" },
      },
      status: "streaming",
    });
    expect(renderSpy).toHaveBeenCalledOnce();
  });

  it("flushes pending deltas before a terminal error", () => {
    vi.useFakeTimers();
    const controller = createController([], []);
    controller.show(selection, anchorRect);
    controller.start("translate");
    controller.appendDelta({
      delta: "部分译文",
      requestId: "analysis-1",
      schemaVersion: 2,
      section: "translation",
      sequence: 0,
      type: "analysis-delta",
    });

    controller.reject({ code: "TIMEOUT", message: "处理超时，请重试。", retryable: true });

    expect(controller.state).toMatchObject({
      preview: { lastSequence: 0, sections: { translation: "部分译文" } },
      status: "error",
    });
  });

  it("flushes before final replacement and preserves valid scroll and focused header action", () => {
    vi.useFakeTimers();
    const controller = createController([], []);
    controller.show(selection, anchorRect);
    controller.start("translate");
    controller.appendDelta({
      delta: "调",
      requestId: "analysis-1",
      schemaVersion: 2,
      section: "contextual-meaning",
      sequence: 0,
      type: "analysis-delta",
    });
    const body = controller.shadowRoot.querySelector<HTMLElement>(".huayi-body");
    if (body !== null) {
      body.scrollTop = 42;
    }
    controller.shadowRoot.querySelector<HTMLButtonElement>("[data-action='close']")?.focus();
    const renderSpy = vi.spyOn(controller.shadowRoot, "replaceChildren");

    controller.resolve(lexicalResult);

    expect(renderSpy).toHaveBeenCalledTimes(2);
    expect(controller.state.status).toBe("result");
    expect(controller.shadowRoot.querySelector<HTMLElement>(".huayi-body")?.scrollTop).toBe(42);
    expect((controller.shadowRoot.activeElement as HTMLElement | null)?.dataset.action).toBe(
      "close",
    );
  });

  it("clears a stale delta batch timer when closed", () => {
    vi.useFakeTimers();
    const controller = createController([], []);
    controller.show(selection, anchorRect);
    controller.start("translate");
    controller.appendDelta({
      delta: "late",
      requestId: "analysis-1",
      schemaVersion: 2,
      section: "translation",
      sequence: 0,
      type: "analysis-delta",
    });
    const renderSpy = vi.spyOn(controller.shadowRoot, "replaceChildren");

    controller.close();
    vi.advanceTimersByTime(40);

    expect(controller.state.status).toBe("closed");
    expect(renderSpy).not.toHaveBeenCalled();
  });
});

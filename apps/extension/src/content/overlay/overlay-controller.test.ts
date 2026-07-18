import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult, AnalyzeAction } from "@huayi/protocol";

import { FakeFrameScheduler } from "./fake-frame-scheduler.test-support.js";
import type { FrameScheduler } from "./frame-scheduler.js";
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
  sentenceContext: "The investigation was in its early stages.",
  wordbookContext: "The investigation was in its early stages.",
} as const;

const lexicalResult: AnalysisResult = {
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
};

const controllers: OverlayController[] = [];

function createController(
  actions: AnalyzeAction[],
  cancellations: number[],
  wordbookSelections: string[] = [],
  frameScheduler?: FrameScheduler,
) {
  const controller = new OverlayController({
    ...(frameScheduler === undefined ? {} : { frameScheduler }),
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
  vi.restoreAllMocks();
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

  it("mounts and repositions a caption overlay through a dynamic presentation", () => {
    const controller = createController([], []);
    const firstMount = document.createElement("div");
    const secondMount = document.createElement("div");
    document.body.append(firstMount, secondMount);
    let mountTarget = firstMount;
    let top = 350;

    controller.show(selection, anchorRect, {
      preferredSide: "above",
      resolveAnchorRect: () => ({ ...anchorRect, bottom: top + 20, top }),
      resolveMountTarget: () => mountTarget,
    });

    const host = firstMount.querySelector<HTMLElement>("[data-huayi-overlay-host]");
    const root = controller.shadowRoot.querySelector<HTMLElement>(".huayi-root");
    expect(host).not.toBeNull();
    expect(root?.style.top).toBe("298px");

    mountTarget = secondMount;
    top = 500;
    controller.refreshPresentation();

    expect(secondMount.querySelector("[data-huayi-overlay-host]")).toBe(host);
    expect(root?.style.top).toBe("448px");
  });

  it("offers only translation for a paragraph", () => {
    const controller = createController([], []);
    controller.show(
      {
        context: "First sentence. Second sentence.",
        selection: "First sentence. Second sentence.",
        selectionKind: "paragraph",
        sentenceContext: null,
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
    expect(controller.shadowRoot.textContent).toContain("添加中");
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

  it("batches text and typed updates with one animation frame", () => {
    const scheduler = new FakeFrameScheduler();
    const controller = createController([], [], [], scheduler);
    controller.show(selection, anchorRect);
    controller.start("translate");
    const renderSpy = vi.spyOn(controller.shadowRoot, "replaceChildren");

    controller.appendUpdate({
      requestId: "analysis-1",
      schemaVersion: 5,
      section: "contextual-sense",
      sequence: 0,
      type: "analysis-section",
      value: { meaningZh: "调查", partOfSpeech: "noun" },
    });
    controller.appendUpdate({
      requestId: "analysis-1",
      schemaVersion: 5,
      section: "common-phrases",
      sequence: 1,
      type: "analysis-section",
      value: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
    });
    controller.appendUpdate({
      requestId: "analysis-1",
      schemaVersion: 5,
      section: "common-meanings",
      sequence: 2,
      type: "analysis-section",
      value: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
    });

    expect(controller.state.status).toBe("loading");
    expect(renderSpy).not.toHaveBeenCalled();
    expect(scheduler.pendingCount).toBe(1);
    expect(renderSpy).not.toHaveBeenCalled();
    scheduler.runFrame();
    expect(controller.state).toMatchObject({
      preview: {
        lastSequence: 2,
        sections: {
          commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
          commonPhrases: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
          contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
        },
        text: {},
      },
      status: "streaming",
    });
    expect(renderSpy).not.toHaveBeenCalled();
    expect(
      Array.from(
        controller.shadowRoot.querySelectorAll(".huayi-section-title"),
        (heading) => heading.textContent,
      ),
    ).toEqual(["语境义", "常见释义", "常用短语"]);
  });

  it("flushes pending deltas before a terminal error", () => {
    vi.useFakeTimers();
    const controller = createController([], []);
    controller.show(selection, anchorRect);
    controller.start("translate");
    controller.appendUpdate({
      delta: "部分译文",
      requestId: "analysis-1",
      schemaVersion: 5,
      section: "translation",
      sequence: 0,
      type: "analysis-delta",
    });

    controller.reject({ code: "TIMEOUT", message: "处理超时，请重试。", retryable: true });

    expect(controller.state).toMatchObject({
      preview: { lastSequence: 0, sections: {}, text: { translation: "部分译文" } },
      status: "error",
    });
  });

  it("retains ordered typed preview and retry after an invalid terminal", () => {
    vi.useFakeTimers();
    const controller = createController([], []);
    controller.show(selection, anchorRect);
    controller.start("translate");
    controller.appendUpdate({
      requestId: "analysis-1",
      schemaVersion: 5,
      section: "contextual-sense",
      sequence: 0,
      type: "analysis-section",
      value: { meaningZh: "调查", partOfSpeech: "noun" },
    });
    controller.appendUpdate({
      requestId: "analysis-1",
      schemaVersion: 5,
      section: "common-phrases",
      sequence: 1,
      type: "analysis-section",
      value: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
    });
    controller.appendUpdate({
      requestId: "analysis-1",
      schemaVersion: 5,
      section: "common-meanings",
      sequence: 2,
      type: "analysis-section",
      value: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
    });

    controller.reject({
      code: "INVALID_RESPONSE",
      message: "模型返回了无效结果。",
      retryable: true,
    });

    expect(controller.state.status).toBe("error");
    expect(
      Array.from(
        controller.shadowRoot.querySelectorAll(".huayi-section-title"),
        (heading) => heading.textContent,
      ),
    ).toEqual(["语境义", "常见释义", "常用短语"]);
    expect(controller.shadowRoot.textContent).toContain("内容未完整生成");
    expect(controller.shadowRoot.querySelector("[data-action='retry']")).not.toBeNull();
  });

  it("flushes before final replacement and preserves valid scroll and focused header action", () => {
    const scheduler = new FakeFrameScheduler();
    const controller = createController([], [], [], scheduler);
    controller.show(selection, anchorRect);
    controller.start("translate");
    controller.appendUpdate({
      delta: "调",
      requestId: "analysis-1",
      schemaVersion: 5,
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

    expect(renderSpy).not.toHaveBeenCalled();
    expect(controller.state.status).toBe("result");
    expect(controller.shadowRoot.querySelector<HTMLElement>(".huayi-body")?.scrollTop).toBe(42);
    expect((controller.shadowRoot.activeElement as HTMLElement | null)?.dataset.action).toBe(
      "close",
    );
  });

  it("clears a stale frame when closed or replaced by a new selection", () => {
    const scheduler = new FakeFrameScheduler();
    const controller = createController([], [], [], scheduler);
    controller.show(selection, anchorRect);
    controller.start("translate");
    controller.appendUpdate({
      delta: "late",
      requestId: "analysis-1",
      schemaVersion: 5,
      section: "translation",
      sequence: 0,
      type: "analysis-delta",
    });
    const renderSpy = vi.spyOn(controller.shadowRoot, "replaceChildren");

    controller.close();
    scheduler.runFrame();

    expect(controller.state.status).toBe("closed");
    expect(renderSpy).not.toHaveBeenCalled();

    controller.show(selection, anchorRect);
    controller.start("translate");
    controller.appendUpdate({
      delta: "stale",
      requestId: "analysis-2",
      schemaVersion: 5,
      section: "translation",
      sequence: 0,
      type: "analysis-delta",
    });
    controller.show({ ...selection, selection: "replacement" }, anchorRect);
    scheduler.runFrame();
    expect(controller.state).toMatchObject({
      selection: { selection: "replacement" },
      status: "actions",
    });
  });
});

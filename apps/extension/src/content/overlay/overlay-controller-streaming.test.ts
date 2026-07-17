import { afterEach, describe, expect, it } from "vitest";

import { FakeFrameScheduler } from "./fake-frame-scheduler.test-support.js";
import { OverlayController } from "./overlay-controller.js";
import { lexicalTranslationResult } from "./render-result.test-fixtures.js";

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

let controller: OverlayController | undefined;

afterEach(() => {
  controller?.destroy();
  controller = undefined;
  document.body.textContent = "";
});

describe("OverlayController streaming patching", () => {
  it("preserves panel DOM, scroll, focus, drag, and wordbook behavior through final correction", () => {
    const scheduler = new FakeFrameScheduler();
    controller = new OverlayController({
      frameScheduler: scheduler,
      onAddWord: () => undefined,
      onAnalyze: () => undefined,
      onCancel: () => undefined,
    });
    controller.show(selection, anchorRect);
    controller.start("translate");
    const panel = controller.shadowRoot.querySelector<HTMLElement>(".huayi-panel");
    const header = controller.shadowRoot.querySelector<HTMLElement>(".huayi-header");
    const body = controller.shadowRoot.querySelector<HTMLElement>(".huayi-body");
    controller.appendUpdate({
      delta: "调",
      requestId: "analysis-1",
      schemaVersion: 5,
      section: "contextual-meaning",
      sequence: 0,
      type: "analysis-delta",
    });
    controller.appendUpdate({
      requestId: "analysis-1",
      schemaVersion: 5,
      section: "collocations",
      sequence: 1,
      type: "analysis-section",
      value: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
    });
    scheduler.runFrame();
    const meaning = controller.shadowRoot.querySelector(
      '[data-huayi-section="contextual-meaning"]',
    );
    const firstItem = controller.shadowRoot.querySelector('[data-huayi-section="collocations"] li');
    if (body !== null) {
      body.scrollTop = 41;
    }
    const close = controller.shadowRoot.querySelector<HTMLButtonElement>("[data-action='close']");
    close?.focus();
    controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-drag-handle]")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));

    controller.resolve(lexicalTranslationResult);

    expect(controller.shadowRoot.querySelector(".huayi-panel")).toBe(panel);
    expect(controller.shadowRoot.querySelector(".huayi-header")).toBe(header);
    expect(controller.shadowRoot.querySelector(".huayi-body")).toBe(body);
    expect(controller.shadowRoot.querySelector('[data-huayi-section="contextual-meaning"]')).toBe(
      meaning,
    );
    expect(controller.shadowRoot.querySelector('[data-huayi-section="collocations"] li')).toBe(
      firstItem,
    );
    expect(body?.scrollTop).toBe(41);
    expect(controller.shadowRoot.activeElement).toBe(close);
    expect(panel?.style.left).toBe("90px");
    expect(controller.shadowRoot.querySelector("[data-action='add-word']")).not.toBeNull();
  });
});

import { afterEach, describe, expect, it } from "vitest";

import type { AnalyzeAction } from "@huayi/protocol";

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

const controllers: OverlayController[] = [];

function createController(actions: AnalyzeAction[], cancellations: number[]) {
  const controller = new OverlayController({
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
});

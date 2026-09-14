import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { click, reading, setup, shadow } from "./store-overlay-controller.test-support.js";

function host(): HTMLElement {
  return shadow().host as HTMLElement;
}
function stream(port: ReturnType<typeof setup>["ports"][number], sequence: number) {
  port.receive({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/analysis-update",
    update: {
      type: "delta",
      requestId: "request-1",
      section: "main-structure",
      sequence,
      text: "主句逐步增长。",
    },
  });
}

describe("Store result placement during streaming", () => {
  let contentHeight = 150;
  beforeEach(() => {
    document.body.textContent = "";
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("innerWidth", 1000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const panel = this.shadowRoot?.querySelector<HTMLElement>(".panel");
      const maximum =
        Number.parseFloat(this.style.getPropertyValue("--overlay-available-height")) || 784;
      const height = panel?.dataset.card === "action" ? 44 : Math.min(contentHeight, maximum);
      return {
        left: 0,
        top: 0,
        bottom: height,
        right: 368,
        width: 368,
        height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
    contentHeight = 150;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("chooses usable space above at promotion instead of jumping across the selection midstream", () => {
    const { controller, ports } = setup();
    controller.show(reading("We agree.", "sentence"), { top: 520, bottom: 540, left: 450 });
    click("[data-action='explain']");
    expect(Number.parseFloat(host().style.top)).toBeLessThan(520);
    contentHeight = 600;
    if (!ports[0]) throw new Error("Missing port");
    stream(ports[0], 0);
    expect(Number.parseFloat(host().style.top)).toBeLessThan(520);
    expect(Number.parseFloat(host().style.getPropertyValue("--overlay-available-height"))).toBe(
      504,
    );
    controller.close();
  });

  it("keeps the bottom placement while content grows and scrolls within its available space", () => {
    const { controller, ports } = setup();
    controller.show(reading("We agree.", "sentence"), { top: 350, bottom: 370, left: 450 });
    click("[data-action='explain']");
    expect(host().style.top).toBe("378px");
    contentHeight = 600;
    if (!ports[0]) throw new Error("Missing port");
    stream(ports[0], 0);
    expect(host().style.top).toBe("378px");
    expect(host().style.getPropertyValue("--overlay-available-height")).toBe("414px");
    controller.close();
  });

  it("reconsiders space when the selection scrolls and resets for a new selection", () => {
    const { controller, ports } = setup();
    const selection = reading("We agree.", "sentence");
    let rangeTop = 350;
    selection.range.getBoundingClientRect = () =>
      ({ top: rangeTop, left: 400, width: 100, height: 20 }) as DOMRect;
    controller.show(selection, { top: 350, bottom: 370, left: 450 });
    click("[data-action='explain']");
    rangeTop = 650;
    document.dispatchEvent(new Event("scroll"));
    expect(Number.parseFloat(host().style.top)).toBeLessThan(650);
    contentHeight = 600;
    if (!ports[0]) throw new Error("Missing port");
    stream(ports[0], 0);
    expect(Number.parseFloat(host().style.top)).toBeLessThan(650);
    controller.show(reading("Another sentence.", "sentence"), { top: 10, bottom: 30, left: 450 });
    click("[data-action='explain']");
    expect(host().style.top).toBe("38px");
    controller.close();
  });

  it("resets the placement on mode changes while ignoring scrolling inside the result body", () => {
    const { controller, ports } = setup();
    controller.show(reading("We agree.", "sentence"), { top: 350, bottom: 370, left: 450 });
    click("[data-action='explain']");
    contentHeight = 600;
    if (!ports[0]) throw new Error("Missing port");
    stream(ports[0], 0);
    shadow()
      .querySelector(".body")
      ?.dispatchEvent(new Event("scroll", { bubbles: true, composed: true }));
    expect(host().style.top).toBe("378px");
    // A mode activation independently chooses space, even before a resize event is delivered.
    vi.stubGlobal("innerHeight", 600);
    click("[data-action='translate']");
    expect(Number.parseFloat(host().style.top)).toBeLessThan(350);
    expect(host().style.getPropertyValue("--overlay-available-height")).toBe("334px");
    controller.close();
  });

  it("uses the visible viewport and recomputes its cap when that viewport resizes", () => {
    const viewport = Object.assign(new EventTarget(), {
      offsetLeft: 30,
      offsetTop: 100,
      width: 600,
      height: 500,
    });
    vi.stubGlobal("visualViewport", viewport);
    const { controller } = setup();
    controller.show(reading("We agree.", "sentence"), { top: 170, bottom: 190, left: 40 });
    click("[data-action='explain']");
    expect(host().style.left).toBe("38px");
    expect(host().style.top).toBe("198px");
    expect(host().style.getPropertyValue("--overlay-available-height")).toBe("394px");
    viewport.height = 300;
    contentHeight = 600;
    viewport.dispatchEvent(new Event("resize"));
    expect(host().style.top).toBe("108px");
    expect(host().style.getPropertyValue("--overlay-available-height")).toBe("284px");
    controller.close();
  });

  it.each([
    [390, 300, 135],
    [390, 240, 105],
    [320, 320, 140],
  ])("reserves the full viewport reading area from promotion at %s × %s", (width, height, top) => {
    vi.stubGlobal("innerWidth", width);
    vi.stubGlobal("innerHeight", height);
    const { controller, ports } = setup();
    controller.show(reading("We agree.", "sentence"), { top, bottom: top + 15, left: width / 2 });
    click("[data-action='explain']");
    const body = shadow().querySelector(".body");
    expect(host().style.top).toBe("8px");
    expect(host().style.getPropertyValue("--overlay-available-height")).toBe(`${height - 16}px`);
    if (!ports[0]) throw new Error("Missing port");
    contentHeight = 600;
    stream(ports[0], 0);
    expect(host().style.top).toBe("8px");
    const mainStructure = "主句为“We agree”；" + "包含宾语从句。".repeat(30) + "最后一行。";
    ports[0].receive({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/analysis-result",
      result: {
        requestId: "request-1",
        sourceText: "We agree.",
        selectionKind: "sentence",
        type: "explain-sentence",
        mainStructure,
        keyExpressions: [{ text: "agree", meaningZh: "同意" }],
        translationZh: "我们同意。",
        contextRole: "说明态度。",
      },
    });
    expect(shadow().querySelector(".body")).toBe(body);
    expect(body?.textContent).toContain(mainStructure);
    expect(body?.textContent).toContain("说明态度。");
    expect(host().style.top).toBe("8px");
    expect(host().getBoundingClientRect().height).toBe(height - 16);
    controller.close();
  });

  it.each([
    [-100, -80],
    [0, 20],
    [170, 190],
    [380, 400],
    [500, 520],
  ])("clamps a small viewport with selection at %s", (top, bottom) => {
    vi.stubGlobal("innerHeight", 400);
    const { controller } = setup();
    controller.show(reading("We agree.", "sentence"), { top, bottom, left: 450 });
    click("[data-action='explain']");
    contentHeight = 600;
    window.dispatchEvent(new Event("resize"));
    const renderedTop = Number.parseFloat(host().style.top);
    expect(renderedTop).toBeGreaterThanOrEqual(8);
    expect(renderedTop + host().getBoundingClientRect().height).toBeLessThanOrEqual(392);
    controller.close();
  });
});

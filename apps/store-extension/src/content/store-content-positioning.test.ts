import { afterEach, expect, it, vi } from "vitest";

import { selectText, setup } from "./overlay/store-overlay-controller.test-support.js";
import { StoreContentApp } from "./store-content-app.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  vi.restoreAllMocks();
  document.body.textContent = "";
  window.getSelection()?.removeAllRanges();
});

function fixture() {
  const paragraph = document.createElement("p");
  paragraph.textContent =
    "A sustained heatwave has caused wildfires. Thousands have left their homes.";
  document.body.append(paragraph);
  const range = selectText(paragraph, paragraph.textContent).getRangeAt(0);
  const displacement = { x: 0, y: 0 };
  const rect = (left: number, top: number, width: number, height: number) =>
    new DOMRect(left + displacement.x, top + displacement.y, width, height);
  function withGeometry(target: Range) {
    Object.defineProperties(target, {
      getBoundingClientRect: { value: () => rect(80, 100, 560, 80) },
      getClientRects: {
        value: () => [rect(80, 100, 560, 20), rect(80, 130, 500, 20), rect(80, 160, 64, 20)],
      },
    });
    return target;
  }
  withGeometry(range);
  const clone = range.cloneRange.bind(range);
  Object.defineProperty(range, "cloneRange", { value: () => withGeometry(clone()) });
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-huayi-store-overlay")
      ? new DOMRect(0, 0, 120, 48)
      : measure.call(this);
  });
  const { controller } = setup();
  const app = new StoreContentApp(document, controller, () => true);
  app.start();
  cleanup.push(() => app.stop());
  return {
    displacement,
    select(clientX: number, clientY: number) {
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX, clientY }));
    },
    keyboard() {
      paragraph.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Shift" }));
    },
    position() {
      const host = document.querySelector<HTMLElement>("[data-huayi-store-overlay]");
      if (!host) throw new Error("Expected action card.");
      return {
        center: Number.parseFloat(host.style.left) + 60,
        top: Number.parseFloat(host.style.top),
      };
    },
  };
}

it.each([
  { x: 120, y: 170, top: 188 },
  { x: 84, y: 110, top: 128 },
])(
  "keeps the actual content app card at release ($x, $y), on that selected line",
  ({ x, y, top }) => {
    const page = fixture();
    page.select(x, y);
    expect(page.position()).toEqual({ center: x, top });
  },
);

it("preserves the mouse anchor when a containing element scrolls without window scrolling", () => {
  const page = fixture();
  page.select(120, 170);
  page.displacement.x = -12;
  page.displacement.y = -30;
  document.dispatchEvent(new Event("scroll"));
  expect(page.position()).toEqual({ center: 108, top: 158 });
});

it("positions keyboard selections from their text bounds without a stale mouse point", () => {
  const page = fixture();
  page.keyboard();
  expect(page.position()).toEqual({ center: 360, top: 188 });
});

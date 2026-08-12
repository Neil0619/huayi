import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreOverlayController } from "./overlay/store-overlay-controller.js";
import { StoreContentApp } from "./store-content-app.js";

function select(element: Element, text: string): void {
  const node = element.firstChild;
  if (!(node instanceof Text)) throw new Error("Expected text fixture.");
  const range = document.createRange();
  const start = node.data.indexOf(text);
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  Object.defineProperty(range, "getBoundingClientRect", {
    value: () => ({ bottom: 40, left: 20, top: 20 }),
  });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("Store content selection app", () => {
  beforeEach(() => {
    document.body.textContent = "";
    window.getSelection()?.removeAllRanges();
  });

  it("enables ordinary-page selection after start and closes for a new invalid selection", () => {
    const controller = { close: vi.fn(), show: vi.fn() } as unknown as StoreOverlayController;
    const app = new StoreContentApp(document, controller, () => true);
    const paragraph = document.createElement("p");
    paragraph.textContent = "The investigation began.";
    document.body.append(paragraph);
    app.start();

    select(paragraph, "investigation");
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 30 }));
    expect(controller.show).toHaveBeenCalledOnce();

    window.getSelection()?.removeAllRanges();
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(controller.close).toHaveBeenCalledOnce();
    app.stop();
  });

  it("does not recreate the overlay when keyboard actions bubble out of its shadow host", () => {
    const controller = { close: vi.fn(), show: vi.fn() } as unknown as StoreOverlayController;
    const app = new StoreContentApp(document, controller, () => true);
    const paragraph = document.createElement("p");
    paragraph.textContent = "The investigation began.";
    const overlayHost = document.createElement("div");
    overlayHost.dataset.huayiStoreOverlay = "";
    document.body.append(paragraph, overlayHost);
    app.start();

    select(paragraph, "investigation");
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 30 }));
    expect(controller.show).toHaveBeenCalledOnce();

    overlayHost.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true, composed: true, key: "Enter" }),
    );
    expect(controller.show).toHaveBeenCalledOnce();
    expect(controller.close).not.toHaveBeenCalled();
    app.stop();
  });

  it("does not create a second overlay for Huayi YouTube caption selections", () => {
    const controller = { close: vi.fn(), show: vi.fn() } as unknown as StoreOverlayController;
    const app = new StoreContentApp(document, controller, () => true);
    const caption = document.createElement("div");
    caption.dataset.huayiStoreYoutubeSubtitles = "";
    const english = document.createElement("span");
    english.textContent = "The investigation began.";
    caption.append(english);
    document.body.append(caption);
    app.start();

    select(english, "investigation");
    english.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 30 }));

    expect(controller.show).not.toHaveBeenCalled();
    expect(controller.close).not.toHaveBeenCalled();
    app.stop();
  });

  it("ignores synthetic page events under the production user-gesture policy", () => {
    const controller = { close: vi.fn(), show: vi.fn() } as unknown as StoreOverlayController;
    const app = new StoreContentApp(document, controller);
    const paragraph = document.createElement("p");
    paragraph.textContent = "The investigation began.";
    document.body.append(paragraph);
    app.start();

    select(paragraph, "investigation");
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 30 }));

    expect(controller.show).not.toHaveBeenCalled();
    app.stop();
  });
});

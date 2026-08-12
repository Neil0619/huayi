import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoreSelectionReading } from "../selection/read-selection.js";
import type { StoreOverlayRuntime } from "./store-overlay-controller.js";
import { getOrCreateStoreOverlay } from "./store-overlay-registry.js";

const OVERLAY_REGISTRY_KEY = Symbol.for("@huayi/store-extension/overlay");

function runtime(): StoreOverlayRuntime {
  return {
    connectAnalysis: vi.fn(),
    openOptions: vi.fn(async () => undefined),
    overlayStylesheetUrl: () => "chrome-extension://test/overlay.css",
    queryWordPresence: vi.fn(async () => undefined),
    saveWord: vi.fn(async () => undefined),
  } as unknown as StoreOverlayRuntime;
}

describe("Store overlay registry", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, OVERLAY_REGISTRY_KEY);
    document.body.textContent = "";
  });

  it("shares one controller and one overlay root across isolated bundles", () => {
    const first = getOrCreateStoreOverlay(document, runtime());
    const second = getOrCreateStoreOverlay(document, runtime());
    const selection = {
      context: "The investigation began.",
      range: document.createRange(),
      selection: "investigation",
      selectionKind: "word",
      sentenceContext: "The investigation began.",
    } satisfies StoreSelectionReading;

    expect(second).toBe(first);
    first.show(selection, { bottom: 10, left: 10, top: 0 });
    second.show(selection, { bottom: 20, left: 20, top: 10 });

    expect(document.querySelectorAll("[data-huayi-store-overlay]")).toHaveLength(1);
    first.close();
  });
});

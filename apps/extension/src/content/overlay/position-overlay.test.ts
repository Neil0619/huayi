import { describe, expect, it } from "vitest";

import { calculateOverlayPosition, clampOverlayPosition } from "./position-overlay.js";

const anchor = {
  bottom: 120,
  height: 20,
  left: 100,
  right: 200,
  top: 100,
  width: 100,
};

describe("calculateOverlayPosition", () => {
  it("places the overlay below the selection when it fits", () => {
    expect(
      calculateOverlayPosition(anchor, { height: 200, width: 420 }, { height: 800, width: 900 }),
    ).toEqual({ left: 100, top: 128 });
  });

  it("flips above the selection near the viewport bottom", () => {
    expect(
      calculateOverlayPosition(
        { ...anchor, bottom: 760, top: 740 },
        { height: 200, width: 420 },
        { height: 800, width: 900 },
      ),
    ).toEqual({ left: 100, top: 532 });
  });

  it("prefers the space above a YouTube caption when requested", () => {
    expect(
      calculateOverlayPosition(
        { ...anchor, bottom: 370, top: 350 },
        { height: 200, width: 420 },
        { height: 800, width: 900 },
        "above",
      ),
    ).toEqual({ left: 100, top: 142 });
  });

  it("centers a YouTube overlay horizontally above its pointer anchor", () => {
    expect(
      calculateOverlayPosition(
        { bottom: 566, height: 0, left: 412, right: 412, top: 566, width: 0 },
        { height: 200, width: 420 },
        { height: 800, width: 900 },
        "above",
      ),
    ).toEqual({ left: 202, top: 358 });
  });

  it("centers an ordinary selection overlay on its horizontal mouse anchor", () => {
    expect(
      calculateOverlayPosition(
        { ...anchor, left: 412, right: 412, width: 0 },
        { height: 44, width: 180 },
        { height: 800, width: 900 },
      ),
    ).toEqual({ left: 322, top: 128 });
  });

  it("falls back below when the preferred space above is unavailable", () => {
    expect(
      calculateOverlayPosition(
        { ...anchor, bottom: 60, top: 40 },
        { height: 200, width: 420 },
        { height: 800, width: 900 },
        "above",
      ),
    ).toEqual({ left: 100, top: 68 });
  });

  it("clamps the overlay inside narrow viewports", () => {
    expect(
      calculateOverlayPosition(
        { ...anchor, left: 390 },
        { height: 200, width: 420 },
        { height: 600, width: 400 },
      ),
    ).toEqual({ left: 8, top: 128 });
  });
});

describe("clampOverlayPosition", () => {
  it("keeps dragged coordinates inside the viewport margin", () => {
    expect(
      clampOverlayPosition(
        { left: -100, top: 900 },
        { height: 300, width: 420 },
        { height: 800, width: 900 },
      ),
    ).toEqual({ left: 8, top: 492 });
  });
});

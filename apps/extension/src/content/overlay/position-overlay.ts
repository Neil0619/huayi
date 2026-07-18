import type { OverlayAnchorRect, OverlayPoint } from "./overlay-state.js";

export interface OverlaySize {
  height: number;
  width: number;
}

export interface ViewportSize {
  height: number;
  width: number;
}

export type OverlayPreferredSide = "above" | "auto";

const VIEWPORT_MARGIN = 8;
const SELECTION_GAP = 8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function calculateOverlayLeft(anchor: OverlayAnchorRect, overlay: OverlaySize): number {
  const isHorizontalPointAnchor = anchor.width === 0 && anchor.left === anchor.right;
  return isHorizontalPointAnchor ? anchor.left - overlay.width / 2 : anchor.left;
}

export function clampOverlayPosition(
  point: OverlayPoint,
  overlay: OverlaySize,
  viewport: ViewportSize,
): OverlayPoint {
  return {
    left: clamp(point.left, VIEWPORT_MARGIN, viewport.width - overlay.width - VIEWPORT_MARGIN),
    top: clamp(point.top, VIEWPORT_MARGIN, viewport.height - overlay.height - VIEWPORT_MARGIN),
  };
}

export function calculateOverlayPosition(
  anchor: OverlayAnchorRect,
  overlay: OverlaySize,
  viewport: ViewportSize,
  preferredSide: OverlayPreferredSide = "auto",
): OverlayPoint {
  const below = anchor.bottom + SELECTION_GAP;
  const above = anchor.top - SELECTION_GAP - overlay.height;
  const top =
    preferredSide === "above"
      ? above >= VIEWPORT_MARGIN
        ? above
        : below
      : below + overlay.height <= viewport.height - VIEWPORT_MARGIN || above < VIEWPORT_MARGIN
        ? below
        : above;

  return clampOverlayPosition(
    { left: calculateOverlayLeft(anchor, overlay), top },
    overlay,
    viewport,
  );
}

export function rectToOverlayAnchor(rect: DOMRect): OverlayAnchorRect {
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  };
}

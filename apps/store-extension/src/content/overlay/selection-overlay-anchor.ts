import type { StoreOverlayAnchor } from "./overlay-runtime.js";

export interface SelectionPointer {
  readonly x: number;
  readonly y: number;
}

export function selectionOverlayAnchor(
  range: Range,
  pointer?: SelectionPointer,
): StoreOverlayAnchor {
  const bounds = range.getBoundingClientRect?.();
  if (!pointer) {
    return {
      left: bounds ? bounds.left + bounds.width / 2 : 12,
      top: bounds?.top ?? 12,
      bottom: bounds?.bottom ?? 24,
    };
  }
  // A multiline range is a large rectangle. Anchor to the selected line nearest the release,
  // including reverse drags, instead of making the user move to the paragraph's bottom centre.
  const distance = (rect: DOMRect) => {
    const x = Math.max(rect.left - pointer.x, 0, pointer.x - rect.right);
    const y = Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom);
    return x * x + y * y;
  };
  const line = Array.from(range.getClientRects?.() ?? [])
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .reduce<DOMRect | undefined>(
      (nearest, rect) =>
        nearest === undefined || distance(rect) < distance(nearest) ? rect : nearest,
      undefined,
    );
  return {
    left: pointer.x,
    top: line?.top ?? pointer.y,
    bottom: line?.bottom ?? pointer.y,
  };
}

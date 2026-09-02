import type { StoreSelectionReading } from "../selection/read-selection.js";
import { readStoreSelection } from "../selection/read-selection.js";

export interface YouTubeCaptionSelection {
  readonly range: Range;
  readonly reading: StoreSelectionReading;
  readonly text: Text;
}

export function readYouTubeCaptionSelection(
  documentRef: Document,
  english: HTMLElement | null,
): YouTubeCaptionSelection | null {
  if (english === null) return null;
  const selection = documentRef.defaultView?.getSelection() ?? null;
  if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const text = english.firstChild;
  if (
    !(text instanceof Text) ||
    range.startContainer !== text ||
    range.endContainer !== text ||
    range.startOffset >= range.endOffset
  ) {
    return null;
  }
  const reading = readStoreSelection(selection);
  return reading === null || reading.context !== text.data ? null : { range, reading, text };
}

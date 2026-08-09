import type { OverlayAnchorRect } from "../overlay/overlay-state.js";
import { normalizeSelectionText } from "../selection/detect-english.js";
import type { SelectionRequestInput } from "../selection/read-selection.js";
import { createCaptionSelection } from "./caption-selection.js";
import type { SubtitleSentence } from "./subtitle-sentence-segmenter.js";

export interface NativeSubtitleSelection {
  anchorRect: OverlayAnchorRect;
  endOffset: number;
  input: SelectionRequestInput;
  sentence: SubtitleSentence;
  startOffset: number;
}

export function isNativeSubtitleSelectionRelease(event: MouseEvent, player: HTMLElement): boolean {
  return (
    event.target instanceof Node &&
    player.contains(event.target) &&
    !event
      .composedPath()
      .some(
        (target) =>
          target instanceof HTMLElement &&
          (target.dataset.huayiOverlayHost !== undefined ||
            target.dataset.huayiYoutubeControlHost !== undefined ||
            target.classList.contains("ytp-chrome-controls")),
      )
  );
}

function anchorRect(range: Range): OverlayAnchorRect {
  const rect = range.getBoundingClientRect();
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  };
}

export function readNativeSubtitleSelection(
  selection: Selection | null,
  englishNode: HTMLElement,
  sentence: SubtitleSentence,
): NativeSubtitleSelection | null {
  if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const textNode = englishNode.firstChild;
  const range = selection.getRangeAt(0);
  if (
    !(textNode instanceof Text) ||
    englishNode.childNodes.length !== 1 ||
    range.collapsed ||
    range.startContainer !== textNode ||
    range.endContainer !== textNode ||
    range.startOffset < 0 ||
    range.endOffset > textNode.data.length ||
    range.startOffset >= range.endOffset ||
    textNode.data !== sentence.text
  ) {
    return null;
  }
  const internalText = sentence.text.slice(range.startOffset, range.endOffset);
  if (normalizeSelectionText(selection.toString()) !== normalizeSelectionText(internalText)) {
    return null;
  }
  const input = createCaptionSelection(internalText, sentence.text);
  return input === null
    ? null
    : {
        anchorRect: anchorRect(range),
        endOffset: range.endOffset,
        input,
        sentence,
        startOffset: range.startOffset,
      };
}

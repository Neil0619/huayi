import { MAX_SELECTION_LENGTH } from "@huayi/protocol";

import { classifySelection } from "../selection/classify-selection.js";
import { isEnglishText, normalizeSelectionText } from "../selection/detect-english.js";
import type { SelectionRequestInput } from "../selection/read-selection.js";

export function createCaptionSelection(
  selectedText: string,
  captionText: string,
): SelectionRequestInput | null {
  const selection = normalizeSelectionText(selectedText);
  const context = normalizeSelectionText(captionText);
  if (
    selection.length === 0 ||
    context.length === 0 ||
    selection.length > MAX_SELECTION_LENGTH ||
    context.length > MAX_SELECTION_LENGTH ||
    !isEnglishText(selection) ||
    !isEnglishText(context) ||
    !context.includes(selection)
  ) {
    return null;
  }
  const selectionKind = selection === context ? "sentence" : classifySelection(selection);
  if (selectionKind === "paragraph") return null;
  return {
    context,
    selection,
    selectionKind,
    sentenceContext: selectionKind === "sentence" ? null : context,
    wordbookContext: selectionKind === "word" ? context : null,
  };
}

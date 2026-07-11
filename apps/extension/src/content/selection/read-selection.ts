import { MAX_SELECTION_LENGTH } from "@huayi/protocol";
import type { SelectionKind } from "@huayi/protocol";

import { classifySelection } from "./classify-selection.js";
import { isEnglishText, normalizeSelectionText } from "./detect-english.js";
import { extractContext } from "./extract-context.js";
import { extractWordbookContext } from "./extract-wordbook-context.js";

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

export interface SelectionRequestInput {
  context: string;
  selection: string;
  selectionKind: SelectionKind;
  wordbookContext: string | null;
}

export interface SelectionReading extends SelectionRequestInput {
  range: Range;
}

function elementForNode(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

function isInsideEditableRegion(range: Range): boolean {
  const elements = [
    elementForNode(range.startContainer),
    elementForNode(range.endContainer),
    elementForNode(range.commonAncestorContainer),
  ];

  return elements.some(
    (element) => element !== null && element.closest(EDITABLE_SELECTOR) !== null,
  );
}

export function readSelection(
  selection: Selection | null = window.getSelection(),
): SelectionReading | null {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (range.collapsed || isInsideEditableRegion(range)) {
    return null;
  }

  const normalizedSelection = normalizeSelectionText(selection.toString());
  if (
    normalizedSelection.length === 0 ||
    normalizedSelection.length > MAX_SELECTION_LENGTH ||
    !isEnglishText(normalizedSelection)
  ) {
    return null;
  }

  const selectionKind = classifySelection(normalizedSelection);
  return {
    context: extractContext(range, normalizedSelection),
    range: range.cloneRange(),
    selection: normalizedSelection,
    selectionKind,
    wordbookContext:
      selectionKind === "word" ? extractWordbookContext(range, normalizedSelection) : null,
  };
}

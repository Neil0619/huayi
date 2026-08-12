import {
  classifyEnglishSelection,
  normalizeSelectionText,
  type SelectionKind,
} from "@huayi/store-domain";

import { extractLexicalSentence, extractSelectionContext } from "./selection-context.js";

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

export interface StoreSelectionReading {
  readonly context: string;
  readonly range: Range;
  readonly selection: string;
  readonly selectionKind: SelectionKind;
  readonly sentenceContext: string | null;
}

function elementForNode(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

function isEditable(range: Range): boolean {
  return [range.startContainer, range.endContainer, range.commonAncestorContainer].some(
    (node) => (elementForNode(node)?.closest(EDITABLE_SELECTOR) ?? null) !== null,
  );
}

export function readStoreSelection(
  selection: Selection | null = window.getSelection(),
): StoreSelectionReading | null {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || isEditable(range)) return null;

  const text = normalizeSelectionText(selection.toString());
  const selectionKind = classifyEnglishSelection(text);
  if (selectionKind === null) return null;
  const lexical = selectionKind === "word" || selectionKind === "phrase";
  const sentenceContext = lexical ? extractLexicalSentence(range, text) : null;
  const extractedContext = extractSelectionContext(range, text);
  return {
    context: classifyEnglishSelection(extractedContext) === null ? text : extractedContext,
    range: range.cloneRange(),
    selection: text,
    selectionKind,
    sentenceContext,
  };
}

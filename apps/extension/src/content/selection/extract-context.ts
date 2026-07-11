import { MAX_CONTEXT_LENGTH } from "@huayi/protocol";

import { normalizeSelectionText } from "./detect-english.js";

const SEMANTIC_BLOCK_TAGS = new Set([
  "ARTICLE",
  "BLOCKQUOTE",
  "DD",
  "DT",
  "FIGCAPTION",
  "LI",
  "P",
  "SECTION",
  "TD",
  "TH",
]);

function elementForNode(node: Node | null): Element | null {
  if (node instanceof Element) {
    return node;
  }

  return node?.parentElement ?? null;
}

export function findSemanticBlock(node: Node | null): Element | null {
  let current = elementForNode(node);

  while (current !== null) {
    if (SEMANTIC_BLOCK_TAGS.has(current.tagName)) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

export function trimContextAroundSelection(
  context: string,
  selection: string,
  maximumLength = MAX_CONTEXT_LENGTH,
): string {
  if (maximumLength <= 0) {
    return "";
  }

  if (context.length <= maximumLength) {
    return context;
  }

  if (selection.length >= maximumLength) {
    return selection.slice(0, maximumLength);
  }

  const selectionStart = context.indexOf(selection);
  if (selectionStart < 0) {
    return context.slice(0, maximumLength);
  }

  const availableSurroundingLength = maximumLength - selection.length;
  const preferredStart = selectionStart - Math.floor(availableSurroundingLength / 2);
  const maximumStart = context.length - maximumLength;
  const windowStart = Math.min(Math.max(0, preferredStart), maximumStart);

  return context.slice(windowStart, windowStart + maximumLength);
}

export function extractContext(range: Range, selection: string): string {
  const semanticBlock =
    findSemanticBlock(range.commonAncestorContainer) ?? findSemanticBlock(range.startContainer);
  const normalizedContext = normalizeSelectionText(semanticBlock?.textContent ?? selection);

  return trimContextAroundSelection(normalizedContext || selection, selection);
}

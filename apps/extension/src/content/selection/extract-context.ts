import { MAX_CONTEXT_LENGTH } from "@huayi/protocol";

import { normalizeSelectionText } from "./detect-english.js";

const SEMANTIC_BLOCK_TAGS = new Set([
  "ARTICLE",
  "BLOCKQUOTE",
  "DD",
  "DT",
  "FIGCAPTION",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
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

function trimContextAroundOffset(
  context: string,
  selection: string,
  selectionStart: number,
  maximumLength: number,
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

  if (selectionStart < 0) {
    return context.slice(0, maximumLength);
  }

  const availableSurroundingLength = maximumLength - selection.length;
  const preferredStart = selectionStart - Math.floor(availableSurroundingLength / 2);
  const maximumStart = context.length - maximumLength;
  const windowStart = Math.min(Math.max(0, preferredStart), maximumStart);

  return context.slice(windowStart, windowStart + maximumLength);
}

export function trimContextAroundSelection(
  context: string,
  selection: string,
  maximumLength = MAX_CONTEXT_LENGTH,
): string {
  return trimContextAroundOffset(context, selection, context.indexOf(selection), maximumLength);
}

function normalizedRangeStart(block: Element, range: Range): number | null {
  if (!block.contains(range.startContainer)) {
    return null;
  }

  try {
    const prefix = block.ownerDocument.createRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(range.startContainer, range.startOffset);
    const marker = "x";
    return normalizeSelectionText(`${prefix.toString()}${marker}`).length - marker.length;
  } catch {
    return null;
  }
}

export function extractContext(range: Range, selection: string): string {
  const semanticBlock =
    findSemanticBlock(range.commonAncestorContainer) ?? findSemanticBlock(range.startContainer);
  const normalizedContext = normalizeSelectionText(semanticBlock?.textContent ?? selection);
  const context = normalizedContext || selection;
  const selectionStart =
    semanticBlock === null
      ? context.indexOf(selection)
      : normalizedRangeStart(semanticBlock, range);

  return selectionStart === null
    ? trimContextAroundSelection(context, selection)
    : trimContextAroundOffset(context, selection, selectionStart, MAX_CONTEXT_LENGTH);
}

import { MAX_CONTEXT_LENGTH } from "@huayi/protocol";

import { isEnglishText, normalizeSelectionText } from "./detect-english.js";
import { findSemanticBlock } from "./extract-context.js";

interface SentenceSpan {
  end: number;
  start: number;
}

const abbreviationPattern =
  /(?:\b(?:Dr|Jr|Mr|Mrs|Ms|Prof|Sr|St|etc|vs)\.|\b(?:e\.g|i\.e)\.|\b[A-Z]\.)\s*$/u;

function mergeAbbreviationSpans(value: string, spans: readonly SentenceSpan[]): SentenceSpan[] {
  const merged: SentenceSpan[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (
      previous !== undefined &&
      abbreviationPattern.test(value.slice(previous.start, previous.end))
    ) {
      previous.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function fallbackSentenceSpans(value: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const boundaryPattern = /[.!?]+["'’”\])}]*(?=\s|$)/gu;
  let start = 0;

  for (const match of value.matchAll(boundaryPattern)) {
    const end = (match.index ?? 0) + match[0].length;
    spans.push({ end, start });
    start = end;
  }

  if (start < value.length || spans.length === 0) {
    spans.push({ end: value.length, start });
  }
  return mergeAbbreviationSpans(value, spans);
}

function sentenceSpans(value: string): SentenceSpan[] {
  if (typeof Intl.Segmenter !== "function") {
    return fallbackSentenceSpans(value);
  }

  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const spans = Array.from(segmenter.segment(value), ({ index, segment }) => ({
    end: index + segment.length,
    start: index,
  }));
  return mergeAbbreviationSpans(value, spans);
}

function textWithLineBreaks(node: Node): string {
  if (node instanceof Text) {
    return node.data;
  }
  if (node instanceof Element && node.tagName === "BR") {
    return " ";
  }
  return Array.from(node.childNodes, (child) => textWithLineBreaks(child)).join("");
}

function rangeOffset(block: Element, container: Node, offset: number): number | null {
  try {
    const prefix = block.ownerDocument.createRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(container, offset);
    return textWithLineBreaks(prefix.cloneContents()).length;
  } catch {
    return null;
  }
}

function normalizedSelectionOffset(
  rawSentence: string,
  rawOffset: number,
  selection: string,
): number {
  const normalizedSentence = normalizeSelectionText(rawSentence).replace(/\s+/gu, " ");
  const approximateOffset = normalizeSelectionText(rawSentence.slice(0, rawOffset)).replace(
    /\s+/gu,
    " ",
  ).length;
  const matches: number[] = [];
  let from = 0;
  while (from <= normalizedSentence.length) {
    const match = normalizedSentence.indexOf(selection, from);
    if (match < 0) {
      break;
    }
    matches.push(match);
    from = match + Math.max(1, selection.length);
  }
  return matches.reduce(
    (closest, candidate) =>
      Math.abs(candidate - approximateOffset) < Math.abs(closest - approximateOffset)
        ? candidate
        : closest,
    matches[0] ?? Math.min(approximateOffset, normalizedSentence.length),
  );
}

function cropAroundOffset(value: string, selectionStart: number, selectionLength: number): string {
  if (value.length <= MAX_CONTEXT_LENGTH) {
    return value;
  }
  const safeSelectionLength = Math.min(selectionLength, MAX_CONTEXT_LENGTH);
  const surroundingLength = MAX_CONTEXT_LENGTH - safeSelectionLength;
  const preferredStart = selectionStart - Math.floor(surroundingLength / 2);
  const windowStart = Math.min(Math.max(0, preferredStart), value.length - MAX_CONTEXT_LENGTH);
  return value.slice(windowStart, windowStart + MAX_CONTEXT_LENGTH);
}

export function extractWordbookContext(range: Range, selection: string): string {
  const normalizedSelection = normalizeSelectionText(selection);
  const block =
    findSemanticBlock(range.commonAncestorContainer) ?? findSemanticBlock(range.startContainer);
  if (block === null) {
    return normalizedSelection;
  }

  const rawContext = textWithLineBreaks(block);
  const segmentationContext = rawContext.replace(/[\s\u00a0]/gu, " ");
  const selectionStart = rangeOffset(block, range.startContainer, range.startOffset);
  const selectionEnd = rangeOffset(block, range.endContainer, range.endOffset);
  if (selectionStart === null || selectionEnd === null) {
    return normalizedSelection;
  }
  const span = sentenceSpans(segmentationContext).find(
    (candidate) => candidate.start <= selectionStart && candidate.end >= selectionEnd,
  );
  if (span === undefined) {
    return normalizedSelection;
  }

  const rawSentence = rawContext.slice(span.start, span.end);
  const normalizedSentence = normalizeSelectionText(rawSentence).replace(/\s+/gu, " ");
  if (!isEnglishText(normalizedSentence)) {
    return normalizedSelection;
  }

  const selectedOffset = normalizedSelectionOffset(
    rawSentence,
    selectionStart - span.start,
    normalizedSelection,
  );
  const cropped = cropAroundOffset(normalizedSentence, selectedOffset, normalizedSelection.length);
  return cropped.includes(normalizedSelection) ? cropped : normalizedSelection;
}

import { MAX_CONTEXT_LENGTH } from "@huayi/protocol";

import { isEnglishText, normalizeSelectionText } from "./detect-english.js";
import { findSemanticBlock } from "./extract-context.js";

interface CroppedSentence {
  start: number;
  value: string;
}

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

function findGenericTextContainer(node: Node): Element | null {
  let current = node instanceof Element ? node : node.parentElement;

  while (current !== null && current.tagName !== "BODY" && current.tagName !== "HTML") {
    if (current.tagName === "DIV") {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function findSentenceBlock(node: Node): Element | null {
  return findSemanticBlock(node) ?? findGenericTextContainer(node);
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

function normalizeSentenceText(value: string): string {
  return normalizeSelectionText(value).replace(/\s+/gu, " ");
}

function normalizedSelectionOffset(
  rawSentence: string,
  rawOffset: number,
  selection: string,
): number | null {
  const normalizedSentence = normalizeSentenceText(rawSentence);
  const approximateOffset = normalizeSentenceText(rawSentence.slice(0, rawOffset)).length;
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
  if (matches.length === 0) {
    return null;
  }
  return matches.reduce((closest, candidate) =>
    Math.abs(candidate - approximateOffset) < Math.abs(closest - approximateOffset)
      ? candidate
      : closest,
  );
}

function cropAroundOffset(
  value: string,
  selectionStart: number,
  selectionLength: number,
): CroppedSentence {
  if (value.length <= MAX_CONTEXT_LENGTH) {
    return { start: 0, value };
  }
  const safeSelectionLength = Math.min(selectionLength, MAX_CONTEXT_LENGTH);
  const surroundingLength = MAX_CONTEXT_LENGTH - safeSelectionLength;
  const preferredStart = selectionStart - Math.floor(surroundingLength / 2);
  const start = Math.min(Math.max(0, preferredStart), value.length - MAX_CONTEXT_LENGTH);
  return { start, value: value.slice(start, start + MAX_CONTEXT_LENGTH) };
}

export function extractSentenceContext(range: Range, selection: string): string | null {
  const normalizedSelection = normalizeSentenceText(selection);
  if (
    !isEnglishText(normalizedSelection) ||
    normalizeSentenceText(range.toString()) !== normalizedSelection
  ) {
    return null;
  }

  const block = findSentenceBlock(range.startContainer);
  const endBlock = findSentenceBlock(range.endContainer);
  if (
    block === null ||
    endBlock === null ||
    block !== endBlock ||
    !block.contains(range.startContainer) ||
    !block.contains(range.endContainer)
  ) {
    return null;
  }

  const rawContext = textWithLineBreaks(block);
  const segmentationContext = rawContext.replace(/[\s\u00a0]/gu, " ");
  const selectionStart = rangeOffset(block, range.startContainer, range.startOffset);
  const selectionEnd = rangeOffset(block, range.endContainer, range.endOffset);
  if (
    selectionStart === null ||
    selectionEnd === null ||
    selectionStart < 0 ||
    selectionEnd < selectionStart ||
    selectionEnd > rawContext.length
  ) {
    return null;
  }

  const span = sentenceSpans(segmentationContext).find(
    (candidate) => candidate.start <= selectionStart && candidate.end >= selectionEnd,
  );
  if (span === undefined) {
    return null;
  }

  const rawSentence = rawContext.slice(span.start, span.end);
  const normalizedSentence = normalizeSentenceText(rawSentence);
  if (!isEnglishText(normalizedSentence)) {
    return null;
  }

  const selectedOffset = normalizedSelectionOffset(
    rawSentence,
    selectionStart - span.start,
    normalizedSelection,
  );
  if (selectedOffset === null) {
    return null;
  }

  const cropped = cropAroundOffset(normalizedSentence, selectedOffset, normalizedSelection.length);
  const selectedOffsetInCrop = selectedOffset - cropped.start;
  return cropped.value.slice(
    selectedOffsetInCrop,
    selectedOffsetInCrop + normalizedSelection.length,
  ) === normalizedSelection
    ? cropped.value
    : null;
}

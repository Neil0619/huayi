import {
  MAX_CONTEXT_SENTENCE_LENGTH,
  isBoundedEnglishSelection,
  normalizeSelectionText,
} from "@huayi/store-domain";

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

function elementForNode(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

export function findSelectionBlock(node: Node): Element | null {
  let current = elementForNode(node);
  while (current !== null && current.tagName !== "BODY" && current.tagName !== "HTML") {
    if (SEMANTIC_BLOCK_TAGS.has(current.tagName) || current.tagName === "DIV") return current;
    current = current.parentElement;
  }
  return null;
}

function cropAround(value: string, selection: string, offset: number): string {
  if (value.length <= MAX_CONTEXT_SENTENCE_LENGTH) return value;
  const surrounding = MAX_CONTEXT_SENTENCE_LENGTH - selection.length;
  const start = Math.min(
    Math.max(0, offset - Math.floor(surrounding / 2)),
    value.length - MAX_CONTEXT_SENTENCE_LENGTH,
  );
  return value.slice(start, start + MAX_CONTEXT_SENTENCE_LENGTH);
}

function normalizedRangeOffset(block: Element, range: Range): number | null {
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

export function extractSelectionContext(range: Range, selection: string): string {
  const block = findSelectionBlock(range.commonAncestorContainer);
  const context = normalizeSelectionText(block?.textContent ?? selection) || selection;
  const offset = block === null ? context.indexOf(selection) : normalizedRangeOffset(block, range);
  return cropAround(context, selection, offset ?? context.indexOf(selection));
}

interface SentenceSpan {
  readonly end: number;
  readonly start: number;
}

const ABBREVIATION_PATTERN =
  /(?:\b(?:Dr|Jr|Mr|Mrs|Ms|Prof|Sr|St|etc|vs)\.|\b(?:e\.g|i\.e)\.|\b[A-Z]\.)\s*$/u;

function mergeAbbreviationSpans(value: string, spans: readonly SentenceSpan[]): SentenceSpan[] {
  const merged: { end: number; start: number }[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (
      previous !== undefined &&
      ABBREVIATION_PATTERN.test(value.slice(previous.start, previous.end))
    ) {
      previous.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function sentenceSpans(value: string): readonly SentenceSpan[] {
  if (typeof Intl.Segmenter === "function") {
    return mergeAbbreviationSpans(
      value,
      Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(value), (item) => ({
        end: item.index + item.segment.length,
        start: item.index,
      })),
    );
  }
  const spans: SentenceSpan[] = [];
  const pattern = /[.!?]+["'’”\])}]*(?=\s|$)/gu;
  let start = 0;
  for (const match of value.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    spans.push({ end, start });
    start = end;
  }
  if (start < value.length || spans.length === 0) spans.push({ end: value.length, start });
  return mergeAbbreviationSpans(value, spans);
}

export function extractLexicalSentence(range: Range, selection: string): string | null {
  const block = findSelectionBlock(range.startContainer);
  if (block === null || !block.contains(range.endContainer)) return null;
  const context = normalizeSelectionText(block.textContent ?? "").replace(/\s+/gu, " ");
  const offset = normalizedRangeOffset(block, range);
  if (offset === null) return null;
  const span = sentenceSpans(context).find(
    (candidate) => candidate.start <= offset && candidate.end >= offset + selection.length,
  );
  if (span === undefined) return null;
  const sentence = context.slice(span.start, span.end).trim();
  if (!isBoundedEnglishSelection(sentence) || !sentence.includes(selection)) return null;
  return cropAround(sentence, selection, sentence.indexOf(selection));
}

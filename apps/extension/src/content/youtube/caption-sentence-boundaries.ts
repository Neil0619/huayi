import { normalizeSelectionText } from "../selection/detect-english.js";

interface SentencePart {
  index: number;
  segment: string;
}

export interface SentenceSegmenter {
  segment(value: string): Iterable<SentencePart>;
}

export interface SentenceBoundarySnapshot {
  complete: boolean;
  overflow: boolean;
  text: string;
}

const MIN_OVERLAP_CHARACTERS = 12;
const MIN_OVERLAP_WORDS = 2;
const SENTENCE_END_PATTERN = /[.!?…]+["'’”)\]}]*/g;
const WORD_PATTERN = /[A-Za-z]+(?:[-'’][A-Za-z]+)*/g;
const NON_TERMINAL_ABBREVIATIONS = new Set([
  "dr.",
  "e.g.",
  "i.e.",
  "jr.",
  "mr.",
  "mrs.",
  "ms.",
  "prof.",
  "sr.",
  "st.",
  "vs.",
]);

export function createDefaultSentenceSegmenter(): SentenceSegmenter | null {
  return typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "sentence" })
    : null;
}

function countWords(value: string): number {
  return [...value.matchAll(WORD_PATTERN)].length;
}

function isFallbackSentenceEnd(
  value: string,
  punctuationStart: number,
  punctuation: string,
): boolean {
  if (punctuation.includes("?") || punctuation.includes("!") || punctuation.includes("…")) {
    return true;
  }

  const dotCount = [...punctuation].filter((character) => character === ".").length;
  if (dotCount > 1) {
    return true;
  }

  const previous = value[punctuationStart - 1];
  const next = value[punctuationStart + 1];
  if (previous !== undefined && next !== undefined && /\d/.test(previous) && /\d/.test(next)) {
    return false;
  }
  if (next !== undefined && /[A-Za-z]/.test(next)) {
    return false;
  }

  const prefix = value.slice(0, punctuationStart + 1);
  const abbreviation = prefix.match(/[A-Za-z.]+$/)?.[0].toLowerCase();
  return (
    abbreviation === undefined ||
    (!/^(?:[a-z]\.){2,}$/.test(abbreviation) && !NON_TERMINAL_ABBREVIATIONS.has(abbreviation))
  );
}

function fallbackSentenceEnds(value: string): number[] {
  const ends: number[] = [];
  for (const match of value.matchAll(SENTENCE_END_PATTERN)) {
    if (match.index !== undefined && isFallbackSentenceEnd(value, match.index, match[0])) {
      ends.push(match.index + match[0].length);
    }
  }
  return ends;
}

function sentenceEnds(value: string, segmenter: SentenceSegmenter | null): number[] {
  if (segmenter === null) {
    return fallbackSentenceEnds(value);
  }

  const ends: number[] = [];
  for (const part of segmenter.segment(value)) {
    const trimmed = part.segment.trimEnd();
    const fallbackEnds = fallbackSentenceEnds(trimmed);
    if (fallbackEnds.at(-1) === trimmed.length) {
      ends.push(part.index + part.segment.lastIndexOf(trimmed) + trimmed.length);
    }
  }
  return ends;
}

export function lastSentence(
  value: string,
  segmenter: SentenceSegmenter | null,
): SentenceBoundarySnapshot {
  const text = normalizeSelectionText(value);
  const ends = sentenceEnds(text, segmenter);
  const lastEnd = ends.at(-1);
  const complete = lastEnd === text.length;
  const previousEnd = complete ? (ends.at(-2) ?? 0) : (lastEnd ?? 0);
  return {
    complete,
    overflow: false,
    text: normalizeSelectionText(text.slice(previousEnd)),
  };
}

export function firstSentence(
  value: string,
  segmenter: SentenceSegmenter | null,
): SentenceBoundarySnapshot {
  const text = normalizeSelectionText(value);
  const end = sentenceEnds(text, segmenter)[0];
  return {
    complete: end !== undefined,
    overflow: false,
    text: end === undefined ? text : normalizeSelectionText(text.slice(0, end)),
  };
}

export function longestSuffixPrefixOverlap(previous: string, next: string): number {
  const maximum = Math.min(previous.length, next.length);
  for (let length = maximum; length > 0; length -= 1) {
    if (previous.slice(-length).toLocaleLowerCase() !== next.slice(0, length).toLocaleLowerCase()) {
      continue;
    }
    const overlap = next.slice(0, length);
    if (
      (length >= MIN_OVERLAP_CHARACTERS || countWords(overlap) >= MIN_OVERLAP_WORDS) &&
      (length === next.length || /\s/.test(next[length] ?? ""))
    ) {
      return length;
    }
  }
  return 0;
}

export function commonPrefixLength(first: string, second: string): number {
  const maximum = Math.min(first.length, second.length);
  let length = 0;
  while (
    length < maximum &&
    first[length]?.toLocaleLowerCase() === second[length]?.toLocaleLowerCase()
  ) {
    length += 1;
  }
  return length;
}

export function isTrustedPrefix(value: string): boolean {
  return value.length >= MIN_OVERLAP_CHARACTERS || countWords(value) >= MIN_OVERLAP_WORDS;
}

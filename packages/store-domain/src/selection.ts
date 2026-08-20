import { MAX_CONTEXT_SENTENCE_LENGTH } from "./normalization.js";

import type { SelectionKind } from "./analysis.js";

const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;
const LATIN_LETTER_PATTERN = /[A-Za-z]/u;
const WORD_PATTERN = /^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/u;
const SENTENCE_END_PATTERN = /[.!?]+(?:["'’”\])}]*)?(?=\s|$)/gu;
const SENTENCE_WORD_THRESHOLD = 8;

export type SelectionBoundaryEvidence =
  | { readonly kind: "dom-passage" }
  | { readonly kind: "dom-sentence" }
  | { readonly kind: "local-rules" }
  | { readonly kind: "youtube-subtitle-sentence" };

export function parseSelectionBoundaryEvidence(value: unknown): SelectionBoundaryEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Selection boundary evidence is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1) {
    throw new TypeError("Selection boundary evidence is invalid.");
  }
  if (
    record.kind !== "dom-passage" &&
    record.kind !== "dom-sentence" &&
    record.kind !== "local-rules" &&
    record.kind !== "youtube-subtitle-sentence"
  ) {
    throw new TypeError("Selection boundary evidence is invalid.");
  }
  return { kind: record.kind };
}

export function normalizeSelectionText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v\u00a0 ]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function isBoundedEnglishSelection(value: string): boolean {
  const normalized = normalizeSelectionText(value);
  return (
    normalized.length > 0 &&
    normalized.length <= MAX_CONTEXT_SENTENCE_LENGTH &&
    LATIN_LETTER_PATTERN.test(normalized) &&
    !HAN_CHARACTER_PATTERN.test(normalized)
  );
}

export function classifyEnglishSelection(
  value: string,
  evidence?: SelectionBoundaryEvidence,
): SelectionKind | null {
  const normalized = normalizeSelectionText(value);
  if (!isBoundedEnglishSelection(normalized)) return null;
  if (WORD_PATTERN.test(normalized)) return "word";

  if (evidence?.kind === "dom-passage") return "passage";
  if (evidence?.kind === "dom-sentence" || evidence?.kind === "youtube-subtitle-sentence") {
    return "sentence";
  }

  const sentenceEndCount = normalized.match(SENTENCE_END_PATTERN)?.length ?? 0;
  const wordCount = normalized.split(/\s+/u).filter(Boolean).length;
  if (sentenceEndCount >= 2 || normalized.includes("\n\n")) return "passage";
  return sentenceEndCount === 1 || normalized.includes("\n") || wordCount >= SENTENCE_WORD_THRESHOLD
    ? "sentence"
    : "phrase";
}

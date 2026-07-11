import type { AnalyzeAction, SelectionKind } from "@huayi/protocol";

import { normalizeSelectionText } from "./detect-english.js";

const WORD_PATTERN = /^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/;
const SENTENCE_END_PATTERN = /[.!?]+(?:["'’”\])}]*)?(?=\s|$)/g;
const SENTENCE_WORD_THRESHOLD = 8;

export function classifySelection(value: string): SelectionKind {
  const normalized = normalizeSelectionText(value);

  if (WORD_PATTERN.test(normalized)) {
    return "word";
  }

  const sentenceEndCount = normalized.match(SENTENCE_END_PATTERN)?.length ?? 0;

  if (normalized.includes("\n") || sentenceEndCount >= 2) {
    return "paragraph";
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (sentenceEndCount === 1 || wordCount >= SENTENCE_WORD_THRESHOLD) {
    return "sentence";
  }

  return "phrase";
}

export function supportsAction(kind: SelectionKind, action: AnalyzeAction): boolean {
  return kind !== "paragraph" || action === "translate";
}

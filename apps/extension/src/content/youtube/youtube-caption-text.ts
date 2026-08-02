import { MAX_CONTEXT_LENGTH } from "@huayi/protocol";

import { isEnglishText, normalizeSelectionText } from "../selection/detect-english.js";
import { trimContextAroundSelection } from "../selection/extract-context.js";
import type { CaptionSnapshot } from "./caption-reader.js";
import type { TimedCaptionCue } from "./youtube-caption-transcript.js";

interface SentenceSpan {
  end: number;
  start: number;
}

export function normalizedCaptionText(value: string): string {
  return normalizeSelectionText(value).replace(/\s+/gu, " ");
}

function fallbackSentenceSpans(value: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const boundary = /[.!?]+["'’”\])}]*(?=\s|$)/gu;
  let start = 0;
  for (const match of value.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].length;
    spans.push({ end, start });
    start = end;
  }
  if (start < value.length || spans.length === 0) {
    spans.push({ end: value.length, start });
  }
  return spans;
}

function sentenceSpans(value: string): SentenceSpan[] {
  if (typeof Intl.Segmenter !== "function") {
    return fallbackSentenceSpans(value);
  }
  return Array.from(
    new Intl.Segmenter("en", { granularity: "sentence" }).segment(value),
    (part) => ({
      end: part.index + part.segment.length,
      start: part.index,
    }),
  );
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[a-z0-9'’]/iu.test(value);
}

function hasOverlapBoundaries(left: string, right: string, length: number): boolean {
  return !isWordCharacter(left[left.length - length - 1]) && !isWordCharacter(right[length]);
}

export function mergeCaptionText(first: string, second: string): string {
  const left = normalizedCaptionText(first);
  const right = normalizedCaptionText(second);
  if (left.length === 0) return right;
  if (right.length === 0 || left === right) return left;
  const maximum = Math.min(left.length, right.length);
  for (let length = maximum; length >= 3; length -= 1) {
    if (
      hasOverlapBoundaries(left, right, length) &&
      left.slice(-length).toLocaleLowerCase("en-US") ===
        right.slice(0, length).toLocaleLowerCase("en-US")
    ) {
      return `${left}${right.slice(length)}`;
    }
  }
  return `${left} ${right}`;
}

function occurrenceNearest(
  value: string,
  selection: string,
  preferredOffset: number,
): number | null {
  const matches: number[] = [];
  let from = 0;
  while (from <= value.length) {
    const match = value.indexOf(selection, from);
    if (match < 0) break;
    matches.push(match);
    from = match + Math.max(1, selection.length);
  }
  if (matches.length === 0) return null;
  return matches.reduce((closest, candidate) =>
    Math.abs(candidate - preferredOffset) < Math.abs(closest - preferredOffset)
      ? candidate
      : closest,
  );
}

export function sentenceAround(
  value: string,
  selection: string,
  preferredOffset = value.length,
): string | null {
  const context = normalizedCaptionText(value);
  const anchor = normalizedCaptionText(selection);
  const selectionStart = occurrenceNearest(context, anchor, preferredOffset);
  if (selectionStart === null) return null;
  const selectionEnd = selectionStart + anchor.length;
  const span = sentenceSpans(context).find(
    (candidate) => candidate.start <= selectionStart && candidate.end >= selectionEnd,
  );
  if (span === undefined) return null;
  const sentence = normalizedCaptionText(context.slice(span.start, span.end));
  if (!isEnglishText(sentence)) return null;
  return sentence.length <= MAX_CONTEXT_LENGTH
    ? sentence
    : trimContextAroundSelection(sentence, anchor, MAX_CONTEXT_LENGTH);
}

function comparableText(value: string): string {
  return normalizedCaptionText(value)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9'’]+/gu, " ")
    .trim();
}

function textsReliablyOverlap(first: string, second: string): boolean {
  const left = comparableText(first);
  const right = comparableText(second);
  return left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left));
}

export function sentenceFromTranscript(
  cues: TimedCaptionCue[],
  current: CaptionSnapshot,
  timeMs: number,
): string | null {
  if (cues.length === 0) return null;
  let activeIndex = cues.findIndex((cue) => cue.startMs <= timeMs && cue.endMs >= timeMs);
  if (activeIndex < 0) {
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const [index, cue] of cues.entries()) {
      const distance = Math.abs(cue.startMs - timeMs);
      if (distance < closestDistance) {
        activeIndex = index;
        closestDistance = distance;
      }
    }
    if (closestDistance > 5_000) return null;
  }
  const activeCue = cues[activeIndex];
  if (activeCue === undefined || !textsReliablyOverlap(current.text, activeCue.text)) return null;
  const windowStart = Math.max(0, activeIndex - 20);
  const windowEnd = Math.min(cues.length, activeIndex + 21);
  let combined = "";
  let activeOffset = 0;
  for (let index = windowStart; index < windowEnd; index += 1) {
    combined = mergeCaptionText(combined, cues[index]?.text ?? "");
    if (index === activeIndex) {
      activeOffset =
        occurrenceNearest(combined, activeCue.text, combined.length) ?? combined.length;
    }
    if (combined.length > MAX_CONTEXT_LENGTH * 2) break;
  }
  const currentText = normalizedCaptionText(current.text);
  const currentOffset = occurrenceNearest(combined, currentText, activeOffset);
  if (currentOffset === null) return null;
  const sentence = sentenceAround(combined, currentText, currentOffset);
  return sentence !== null && sentence.includes(currentText) ? sentence : null;
}

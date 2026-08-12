import type { TimedTextCue } from "./youtube-bridge-contract.js";

export interface SubtitleSentence {
  readonly endMs: number;
  readonly startMs: number;
  readonly text: string;
}

const GAP_BOUNDARY_MS = 1_500;
const SOFT_DURATION_MS = 12_000;
const HARD_DURATION_MS = 15_000;
const SOFT_CODE_POINTS = 120;
const HARD_CODE_POINTS = 200;
const SENTENCE_END_PATTERN = /[.!?]+["'’”\])}]*$/u;

function normalized(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function mergeEnglish(first: string, second: string): string {
  const left = normalized(first);
  const right = normalized(second);
  if (left.length === 0) return right;
  if (right.length === 0 || left === right || left.endsWith(right)) return left;
  if (right.startsWith(left)) return right;
  for (let length = Math.min(left.length, right.length); length >= 3; length -= 1) {
    if (
      left.slice(-length).toLocaleLowerCase("en-US") ===
      right.slice(0, length).toLocaleLowerCase("en-US")
    ) {
      return `${left}${right.slice(length)}`;
    }
  }
  return `${left} ${right}`;
}

function shouldFlush(sentence: SubtitleSentence): boolean {
  const duration = sentence.endMs - sentence.startMs;
  const length = [...sentence.text].length;
  return (
    SENTENCE_END_PATTERN.test(sentence.text) ||
    length >= SOFT_CODE_POINTS ||
    duration >= SOFT_DURATION_MS ||
    length >= HARD_CODE_POINTS ||
    duration >= HARD_DURATION_MS
  );
}

function exceedsBounds(sentence: SubtitleSentence): boolean {
  const duration = sentence.endMs - sentence.startMs;
  const length = [...sentence.text].length;
  return (
    length >= SOFT_CODE_POINTS ||
    duration >= SOFT_DURATION_MS ||
    length > HARD_CODE_POINTS ||
    duration > HARD_DURATION_MS
  );
}

export function segmentSubtitleCues(cues: readonly TimedTextCue[]): SubtitleSentence[] {
  const sentences: SubtitleSentence[] = [];
  let current: SubtitleSentence | null = null;
  const flush = (): void => {
    if (current !== null && current.text.length > 0) sentences.push(current);
    current = null;
  };
  for (const cue of [...cues].sort(
    (first, second) => first.startMs - second.startMs || first.endMs - second.endMs,
  )) {
    const text = normalized(cue.text);
    if (text.length === 0 || cue.endMs < cue.startMs) continue;
    if (current !== null) {
      const candidate = {
        endMs: Math.max(current.endMs, cue.endMs),
        startMs: current.startMs,
        text: mergeEnglish(current.text, text),
      };
      if (
        cue.startMs - current.endMs >= GAP_BOUNDARY_MS ||
        SENTENCE_END_PATTERN.test(current.text) ||
        exceedsBounds(candidate)
      ) {
        flush();
      }
    }
    current =
      current === null
        ? { endMs: cue.endMs, startMs: cue.startMs, text }
        : {
            endMs: Math.max(current.endMs, cue.endMs),
            startMs: current.startMs,
            text: mergeEnglish(current.text, text),
          };
    if (shouldFlush(current)) flush();
  }
  flush();
  return sentences;
}

export function findSubtitleSentenceAt(
  sentences: readonly SubtitleSentence[],
  timeMs: number,
): SubtitleSentence | null {
  return (
    sentences.find((sentence) => sentence.startMs <= timeMs && timeMs < sentence.endMs) ?? null
  );
}

function mergeTranslated(first: string, second: string): string {
  const left = normalized(first);
  const right = normalized(second);
  if (left.length === 0) return right;
  if (right.length === 0 || left === right || left.endsWith(right)) return left;
  if (right.startsWith(left)) return right;
  for (let length = Math.min(left.length, right.length); length >= 1; length -= 1) {
    if (left.slice(-length) === right.slice(0, length)) return `${left}${right.slice(length)}`;
  }
  const separator = /\p{Script=Han}$/u.test(left) && /^\p{Script=Han}/u.test(right) ? "" : " ";
  return `${left}${separator}${right}`;
}

export function alignTranslatedSentence(
  sentence: SubtitleSentence,
  cues: readonly TimedTextCue[],
): string | null {
  const text = cues
    .filter((cue) => cue.startMs < sentence.endMs && cue.endMs > sentence.startMs)
    .sort((first, second) => first.startMs - second.startMs || first.endMs - second.endMs)
    .reduce((combined, cue) => mergeTranslated(combined, cue.text), "");
  return text.length === 0 ? null : text;
}

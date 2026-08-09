import type { TimedCaptionCue } from "./youtube-caption-transcript.js";
import { mergeCaptionText, normalizedCaptionText } from "./youtube-caption-text.js";

export interface SubtitleSentence {
  endMs: number;
  startMs: number;
  text: string;
}

export interface SubtitleSentenceSegmenter {
  segment(cues: readonly TimedCaptionCue[]): SubtitleSentence[];
}

const GAP_BOUNDARY_MS = 1_500;
const SOFT_DURATION_MS = 12_000;
const HARD_DURATION_MS = 15_000;
const SOFT_CODE_POINTS = 120;
const HARD_CODE_POINTS = 200;
const SENTENCE_END_PATTERN = /[.!?]+["'’”\])}]*$/u;

function codePointLength(value: string): number {
  return [...value].length;
}

function endsSentence(value: string): boolean {
  return SENTENCE_END_PATTERN.test(value.trimEnd());
}

function flushSentence(sentences: SubtitleSentence[], current: SubtitleSentence | null): null {
  if (current !== null && current.text.length > 0) {
    sentences.push(current);
  }
  return null;
}

function appendCue(
  current: SubtitleSentence | null,
  cue: TimedCaptionCue,
  text: string,
): SubtitleSentence {
  if (current === null) {
    return { endMs: cue.endMs, startMs: cue.startMs, text };
  }
  return {
    endMs: Math.max(current.endMs, cue.endMs),
    startMs: current.startMs,
    text: mergeCaptionText(current.text, text),
  };
}

export class LocalSubtitleSentenceSegmenter implements SubtitleSentenceSegmenter {
  segment(cues: readonly TimedCaptionCue[]): SubtitleSentence[] {
    const ordered = [...cues].sort(
      (first, second) => first.startMs - second.startMs || first.endMs - second.endMs,
    );
    const sentences: SubtitleSentence[] = [];
    let current: SubtitleSentence | null = null;

    for (const cue of ordered) {
      const text = normalizedCaptionText(cue.text);
      if (text.length === 0 || cue.endMs < cue.startMs) {
        continue;
      }

      if (current !== null) {
        const gapMs = cue.startMs - current.endMs;
        const candidateText = mergeCaptionText(current.text, text);
        const candidateDurationMs = cue.endMs - current.startMs;
        if (
          gapMs >= GAP_BOUNDARY_MS ||
          endsSentence(current.text) ||
          codePointLength(candidateText) >= SOFT_CODE_POINTS ||
          candidateDurationMs >= SOFT_DURATION_MS ||
          codePointLength(candidateText) > HARD_CODE_POINTS ||
          candidateDurationMs > HARD_DURATION_MS
        ) {
          current = flushSentence(sentences, current);
        }
      }

      current = appendCue(current, cue, text);

      const durationMs = current.endMs - current.startMs;
      if (
        endsSentence(current.text) ||
        codePointLength(current.text) >= SOFT_CODE_POINTS ||
        durationMs >= SOFT_DURATION_MS ||
        codePointLength(current.text) >= HARD_CODE_POINTS ||
        durationMs >= HARD_DURATION_MS
      ) {
        current = flushSentence(sentences, current);
      }
    }

    flushSentence(sentences, current);
    return sentences;
  }
}

export function findSubtitleSentenceAt(
  sentences: readonly SubtitleSentence[],
  timeMs: number,
): SubtitleSentence | null {
  return (
    sentences.find((sentence) => sentence.startMs <= timeMs && timeMs < sentence.endMs) ?? null
  );
}

function mergeTranslatedText(first: string, second: string): string {
  const left = normalizedCaptionText(first);
  const right = normalizedCaptionText(second);
  if (left.length === 0) return right;
  if (right.length === 0 || left === right || left.endsWith(right)) return left;
  if (right.startsWith(left)) return right;

  const maximum = Math.min(left.length, right.length);
  for (let length = maximum; length >= 1; length -= 1) {
    if (left.slice(-length) === right.slice(0, length)) {
      return `${left}${right.slice(length)}`;
    }
  }

  const separator = /\p{Script=Han}$/u.test(left) && /^\p{Script=Han}/u.test(right) ? "" : " ";
  return `${left}${separator}${right}`;
}

export function alignTranslatedSentence(
  sentence: SubtitleSentence,
  translatedCues: readonly TimedCaptionCue[],
): string | null {
  const text = translatedCues
    .filter((cue) => cue.startMs < sentence.endMs && cue.endMs > sentence.startMs)
    .sort((first, second) => first.startMs - second.startMs || first.endMs - second.endMs)
    .reduce((merged, cue) => mergeTranslatedText(merged, cue.text), "");
  return text.length > 0 ? text : null;
}

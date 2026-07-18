import { MAX_SELECTION_LENGTH } from "@huayi/protocol";

import { classifySelection } from "../selection/classify-selection.js";
import { isEnglishText, normalizeSelectionText } from "../selection/detect-english.js";
import type { SelectionRequestInput } from "../selection/read-selection.js";

export interface CaptionTextSegment {
  end: number;
  isWordLike: boolean;
  start: number;
  text: string;
}

type CaptionSegmenter = Pick<Intl.Segmenter, "segment">;

const FALLBACK_WORD_PATTERN = /[A-Za-z]+(?:[-'’][A-Za-z]+)*/g;
const WORD_CONNECTOR_PATTERN = /^[-'’]$/;

function createDefaultSegmenter(): CaptionSegmenter | null {
  return typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "word" })
    : null;
}

function fallbackSegments(value: string): CaptionTextSegment[] {
  const segments: CaptionTextSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(FALLBACK_WORD_PATTERN)) {
    const start = match.index;
    if (start > cursor) {
      segments.push({
        end: start,
        isWordLike: false,
        start: cursor,
        text: value.slice(cursor, start),
      });
    }
    const end = start + match[0].length;
    segments.push({ end, isWordLike: true, start, text: match[0] });
    cursor = end;
  }

  if (cursor < value.length) {
    segments.push({
      end: value.length,
      isWordLike: false,
      start: cursor,
      text: value.slice(cursor),
    });
  }
  return segments;
}

function mergeConnectedWords(segments: CaptionTextSegment[]): CaptionTextSegment[] {
  const merged: CaptionTextSegment[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index];
    const previous = merged.at(-1);
    const next = segments[index + 1];
    if (
      current !== undefined &&
      previous?.isWordLike === true &&
      current.isWordLike === false &&
      WORD_CONNECTOR_PATTERN.test(current.text) &&
      next?.isWordLike === true
    ) {
      previous.end = next.end;
      previous.text += current.text + next.text;
      index += 1;
      continue;
    }
    if (current !== undefined) {
      merged.push({ ...current });
    }
  }
  return merged;
}

export function segmentCaptionText(
  value: string,
  segmenter: CaptionSegmenter | null = createDefaultSegmenter(),
): CaptionTextSegment[] {
  if (segmenter === null) {
    return fallbackSegments(value);
  }

  const segments = [...segmenter.segment(value)].map((part) => ({
    end: part.index + part.segment.length,
    isWordLike: part.isWordLike === true,
    start: part.index,
    text: part.segment,
  }));
  return mergeConnectedWords(segments);
}

export function createCaptionSelection(
  selectedText: string,
  captionText: string,
): SelectionRequestInput | null {
  const selection = normalizeSelectionText(selectedText);
  const context = normalizeSelectionText(captionText);
  if (
    selection.length === 0 ||
    context.length === 0 ||
    selection.length > MAX_SELECTION_LENGTH ||
    context.length > MAX_SELECTION_LENGTH ||
    !isEnglishText(selection) ||
    !isEnglishText(context) ||
    !context.includes(selection)
  ) {
    return null;
  }

  const selectionKind = classifySelection(selection);
  const lexical = selectionKind === "word" || selectionKind === "phrase";
  return {
    context,
    selection,
    selectionKind,
    sentenceContext: lexical ? context : null,
    wordbookContext: selectionKind === "word" ? context : null,
  };
}

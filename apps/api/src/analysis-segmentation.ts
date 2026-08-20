import type { SegmentedSentence } from "./analysis-ports.js";

const abbreviations = new Set(["dr.", "mr.", "mrs.", "ms.", "prof.", "e.g.", "i.e."]);

export function segmentSentences(sourceText: string): SegmentedSentence[] {
  const values: string[] = [];
  let start = 0;
  for (let index = 0; index < sourceText.length; index += 1) {
    if (!".!?".includes(sourceText[index] ?? "") || !/\s/u.test(sourceText[index + 1] ?? ""))
      continue;
    const candidate = sourceText.slice(start, index + 1).trim();
    const lastToken = candidate.split(/\s+/u).at(-1)?.toLowerCase();
    if (lastToken !== undefined && abbreviations.has(lastToken)) continue;
    if (candidate !== "") values.push(candidate);
    start = index + 1;
  }
  const tail = sourceText.slice(start).trim();
  if (tail !== "") values.push(tail);
  return values.slice(0, 40).map((value, ordinal) => ({
    analysisUnitId: `u${ordinal + 1}`,
    ordinal,
    sourceText: value,
  }));
}

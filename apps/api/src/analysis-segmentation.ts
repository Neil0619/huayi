import type { SegmentedSentence } from "./analysis-ports.js";
import type { StartAnalysisRequest } from "@huayi/cloud-contracts";
import { CloudFault } from "./cloud-fault.js";

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
  return values.map((value, ordinal) => ({
    analysisUnitId: `u${ordinal + 1}`,
    ordinal,
    sourceText: value,
  }));
}

export function analysisSourceUnits(input: StartAnalysisRequest): SegmentedSentence[] {
  const units =
    input.selectionKind === "phrase"
      ? [{ analysisUnitId: "u1", ordinal: 0, sourceText: input.sourceText }]
      : segmentSentences(input.sourceText);
  if (!hasCompleteAnalysisSource(input, units)) {
    throw new CloudFault("invalid_request", "请将原文拆成不超过 40 个句子的段落后再分析。");
  }
  return units;
}

/** Only whitespace between source units may be skipped; never normalize a unit's text. */
export function hasCompleteAnalysisSource(
  input: StartAnalysisRequest,
  units: readonly SegmentedSentence[],
): boolean {
  if (
    units.length < 1 ||
    units.length > 40 ||
    (input.selectionKind === "phrase" && units.length !== 1)
  )
    return false;
  let cursor = 0;
  for (const [index, unit] of units.entries()) {
    while (/\s/u.test(input.sourceText[cursor] ?? "")) cursor += 1;
    if (
      unit.analysisUnitId !== `u${index + 1}` ||
      unit.ordinal !== index ||
      !unit.sourceText.trim() ||
      !input.sourceText.startsWith(unit.sourceText, cursor)
    )
      return false;
    cursor += unit.sourceText.length;
  }
  return input.sourceText.slice(cursor).trim() === "";
}

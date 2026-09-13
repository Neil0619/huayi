import type { StructuredSentenceUnit } from "./structured-sentence-unit.js";
import type { SentenceExplanationV2Result } from "./structured-store-results.js";
import { partitionSentenceSource } from "./sentence-source-partition.js";
import {
  checkTeachingStructure,
  sourceCheckFailure,
  type SourceCheckFailure,
} from "./teaching-source-checks.js";

/** Shared binding for already shape-validated transport values. */
export function checkSentenceUnitForSource(
  sourceText: string,
  unit: StructuredSentenceUnit,
  invalid: SourceCheckFailure = sourceCheckFailure,
): void {
  const expected = partitionSentenceSource(sourceText, invalid)[unit.ordinal];
  if (
    !expected ||
    expected.analysisUnitId !== unit.analysisUnitId ||
    expected.sourceText !== unit.sourceText
  )
    invalid(["sentenceStructures", unit.ordinal], "Unit must match the trusted source partition.");
  checkTeachingStructure(unit.sourceText, unit.sentenceStructure, invalid);
}
export function checkSentenceExplanationSource(
  result: SentenceExplanationV2Result,
  sourceText: string,
  invalid: SourceCheckFailure = sourceCheckFailure,
): void {
  if (result.sourceText !== sourceText) invalid(["sourceText"], "Exact request source required.");
  const units = partitionSentenceSource(sourceText, invalid);
  if (units.length !== result.sentenceStructures.length)
    invalid(["sentenceStructures"], "Exactly one structure per trusted source unit is required.");
  for (const [index, unit] of result.sentenceStructures.entries()) {
    if (unit.ordinal !== index) invalid(["sentenceStructures", index], "Source order required.");
    checkSentenceUnitForSource(sourceText, unit, invalid);
  }
}

/** Semantic field order is stable across JSON serializers; raw fragment text is never normalized. */
export function sentenceUnitSignature(unit: StructuredSentenceUnit): string {
  const group = (value: StructuredSentenceUnit["sentenceStructure"]["coreClauses"][number]) => [
    value.explanationZh.trim(),
    value.fragments.map((fragment) => [fragment.text, fragment.start, fragment.end]),
  ];
  return JSON.stringify([
    unit.analysisUnitId,
    unit.ordinal,
    unit.sourceText,
    unit.sentenceStructure.kind,
    unit.sentenceStructure.coreClauses.map(group),
    unit.sentenceStructure.modifiers.map((modifier) => [
      ...group(modifier),
      modifier.relation,
      modifier.target.kind,
      modifier.target.index,
    ]),
  ]);
}

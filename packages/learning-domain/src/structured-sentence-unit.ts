import { z } from "zod/v3";
import { sentenceSourceUnitSchema } from "./sentence-source-units.js";
import { sentenceStructureSchema, validateSentenceStructureSource } from "./teaching-structure.js";
import { boundedLegacyText, legacyStructurePoints } from "./structured-teaching-legacy.js";

/** Shared Web/Store unit boundary, also used before publishing a complete streaming unit. */
export const structuredSentenceUnitSchema = sentenceSourceUnitSchema
  .extend({
    sentenceStructure: sentenceStructureSchema,
  })
  .superRefine((unit, context) => {
    if (unit.analysisUnitId !== `u${unit.ordinal + 1}`)
      context.addIssue({
        code: "custom",
        path: ["analysisUnitId"],
        message: "Unit id must match its ordinal.",
      });
    try {
      validateSentenceStructureSource(unit.sourceText, unit.sentenceStructure);
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      for (const issue of error.issues)
        context.addIssue({ ...issue, path: ["sentenceStructure", ...issue.path] });
    }
  });
export type StructuredSentenceUnit = z.infer<typeof structuredSentenceUnitSchema>;

export function projectStructuredSentencePreview(value: StructuredSentenceUnit): string {
  const unit = structuredSentenceUnitSchema.parse(value);
  return boundedLegacyText(
    [
      `第 ${unit.ordinal + 1} 句：${unit.sourceText}`,
      ...legacyStructurePoints(unit.sentenceStructure).map(
        (point) => `${point.label}：${point.explanationZh}`,
      ),
    ].join("\n"),
    4096,
  );
}

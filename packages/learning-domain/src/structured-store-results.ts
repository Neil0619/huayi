import { z } from "zod/v3";
import {
  sentenceExplanationResultSchema,
  storeAnalysisResultSchema,
  type StoreAnalysisResult,
} from "./analysis-results.js";
import { validateSentenceSourceUnits } from "./sentence-source-units.js";
import { structuredSentenceUnitSchema } from "./structured-sentence-unit.js";
import { boundedLegacyText, legacyStructurePoints } from "./structured-teaching-legacy.js";
import { validateStructuredPayloadBudget } from "./structured-payload-budget.js";

export const STRUCTURED_TEACHING_CONTRACT = "structured-teaching-v1" as const;
const resultObject = sentenceExplanationResultSchema
  .omit({ mainStructure: true, type: true })
  .extend({
    sourceText: z.string().min(1).max(2000).regex(/\S/u),
    sentenceStructures: z.array(structuredSentenceUnitSchema).min(1).max(40),
    type: z.literal("explain-sentence-v2"),
  });
export const sentenceExplanationV2ResultSchema = resultObject.superRefine((result, context) => {
  try {
    validateSentenceSourceUnits(
      result.sourceText,
      result.sentenceStructures.map(({ sentenceStructure, ...unit }) => {
        void sentenceStructure;
        return unit;
      }),
    );
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    for (const issue of error.issues)
      context.addIssue({ ...issue, path: ["sentenceStructures", ...issue.path] });
  }
  try {
    validateStructuredPayloadBudget(result);
    validateStructuredPayloadBudget(legacyResult(result));
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    for (const issue of error.issues) context.addIssue(issue);
  }
});
export type SentenceExplanationV2Result = z.infer<typeof sentenceExplanationV2ResultSchema>;
export const storeAnalysisReadResultSchema = z.union([
  storeAnalysisResultSchema,
  sentenceExplanationV2ResultSchema,
]);
export type StoreAnalysisReadResult = z.infer<typeof storeAnalysisReadResultSchema>;

export function projectStoreResultForLegacy(value: StoreAnalysisReadResult): StoreAnalysisResult {
  const result = storeAnalysisReadResultSchema.parse(value);
  if (result.type !== "explain-sentence-v2") return result;
  return legacyResult(result);
}

function legacyResult(result: z.infer<typeof resultObject>): StoreAnalysisResult {
  const { sentenceStructures, ...fields } = result;
  const mainStructure = sentenceStructures
    .map((unit, index) =>
      [
        `第 ${index + 1} 句：${unit.sourceText}`,
        ...legacyStructurePoints(unit.sentenceStructure).map(
          (point) => `${point.label}：${point.explanationZh}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
  return sentenceExplanationResultSchema.parse({
    ...fields,
    type: "explain-sentence",
    mainStructure: boundedLegacyText(mainStructure, 4000),
  });
}

import { z } from "zod/v3";
import {
  analysisContentSchema,
  analysisRecordSchema,
  phraseAnalysisSchema,
  sentencePassageAnalysisSchema,
  webDeepAnalysisSchema,
  type AnalysisContent,
  type AnalysisRecord,
  type WebDeepAnalysis,
} from "./domain-schemas.js";
import {
  learningRecommendationSchema,
  validateLearningRecommendationSources,
} from "./learning-recommendations.js";
import { sentenceStructureSchema } from "./teaching-structure.js";
import { sentenceSourceUnitSchema, validateSentenceSourceUnits } from "./sentence-source-units.js";
import { structuredSentenceUnitSchema } from "./structured-sentence-unit.js";
import { legacyStructurePoints } from "./structured-teaching-legacy.js";
import { validateStructuredPayloadBudget } from "./structured-payload-budget.js";

const recommendations = z.array(learningRecommendationSchema).max(3);
const phraseObject = phraseAnalysisSchema.innerType().extend({
  type: z.literal("phrase-analysis-v3"),
  recommendations,
});
const structuredSentenceSchema = sentencePassageAnalysisSchema
  .innerType()
  .shape.sentences.element.omit({ structure: true })
  .extend({
    ...sentenceSourceUnitSchema.shape,
    sentenceStructure: sentenceStructureSchema,
  });
const sentencePassageObject = sentencePassageAnalysisSchema.innerType().extend({
  type: z.literal("sentence-passage-analysis-v3"),
  sentences: z.array(structuredSentenceSchema).min(1).max(40),
  recommendations,
});
type StructuredWebShape = z.infer<typeof phraseObject> | z.infer<typeof sentencePassageObject>;

function verify(
  context: z.RefinementCtx,
  operation: () => unknown,
  path: (string | number)[] = [],
) {
  try {
    operation();
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    for (const issue of error.issues)
      context.addIssue({ ...issue, path: [...path, ...issue.path] });
  }
}

/** Private shape projection, used only after structural parsing or inside its refinement. */
function legacyResult(result: StructuredWebShape): WebDeepAnalysis {
  if (result.type === "phrase-analysis-v3") {
    const { recommendations, ...fields } = result;
    void recommendations;
    return phraseAnalysisSchema.parse({ ...fields, type: "phrase-analysis-v2" });
  }
  const { recommendations, sentences, ...fields } = result;
  void recommendations;
  return sentencePassageAnalysisSchema.parse({
    ...fields,
    type: "sentence-passage-analysis-v2",
    sentences: sentences.map(({ sentenceStructure, ...sentence }) => ({
      ...sentence,
      structure: legacyStructurePoints(sentenceStructure),
    })),
  });
}

export const phraseAnalysisV3Schema = phraseObject.superRefine((value, context) => {
  verify(context, () => legacyResult(value));
});
export const sentencePassageAnalysisV3Schema = sentencePassageObject.superRefine(
  (value, context) => {
    verify(context, () => legacyResult(value));
    value.sentences.forEach((sentence, index) => {
      verify(
        context,
        () =>
          structuredSentenceUnitSchema.parse({
            analysisUnitId: sentence.analysisUnitId,
            ordinal: sentence.ordinal,
            sourceText: sentence.sourceText,
            sentenceStructure: sentence.sentenceStructure,
          }),
        ["sentences", index],
      );
    });
  },
);
export const webStructuredAnalysisSchema = z.union([
  phraseAnalysisV3Schema,
  sentencePassageAnalysisV3Schema,
]);
export type WebStructuredAnalysis = z.infer<typeof webStructuredAnalysisSchema>;
export const webDeepAnalysisReadSchema = z.union([
  webDeepAnalysisSchema,
  webStructuredAnalysisSchema,
]);

const structuredContentFields = {
  result: webStructuredAnalysisSchema,
  sourceText: z.string().min(1).max(2000).regex(/\S/u),
  modelMetadata: analysisContentSchema
    .innerType()
    .shape.modelMetadata.extend({ schemaVersion: z.literal(3) }),
};
const contentObject = analysisContentSchema.innerType().extend(structuredContentFields);

function validateStructuredContent(
  value: z.infer<typeof contentObject>,
  context: z.RefinementCtx,
): void {
  verify(context, () => validateStructuredPayloadBudget(value));
  // Reuse the frozen candidate cardinality, ownership, selection-kind and ordinal invariants.
  verify(context, () => {
    const legacy = analysisContentSchema.parse({ ...value, result: legacyResult(value.result) });
    validateStructuredPayloadBudget(legacy);
  });
  const units =
    value.result.type === "phrase-analysis-v3"
      ? [{ analysisUnitId: "u1", sourceText: value.sourceText }]
      : value.result.sentences.map(({ analysisUnitId, sourceText }) => ({
          analysisUnitId,
          sourceText,
        }));
  if (value.result.type === "sentence-passage-analysis-v3") {
    const sourceUnits = value.result.sentences.map(({ analysisUnitId, ordinal, sourceText }) => ({
      analysisUnitId,
      ordinal,
      sourceText,
    }));
    verify(context, () => validateSentenceSourceUnits(value.sourceText, sourceUnits), [
      "result",
      "sentences",
    ]);
  }
  verify(
    context,
    () =>
      validateLearningRecommendationSources(units, value.candidates, value.result.recommendations),
    ["result", "recommendations"],
  );
  const sources = new Map(units.map((unit) => [unit.analysisUnitId, unit.sourceText]));
  value.candidates.forEach((candidate, index) => {
    const source = sources.get(candidate.analysisUnitId);
    if (
      source !== undefined &&
      candidate.payload.type === "expression" &&
      !source.includes(candidate.payload.text)
    )
      context.addIssue({
        code: "custom",
        path: ["candidates", index, "payload", "text"],
        message: "Expression must match its exact source unit.",
      });
  });
  const groups =
    value.result.type === "phrase-analysis-v3"
      ? [
          {
            source: value.sourceText,
            points: value.result.usageNotes,
            path: ["result", "usageNotes"],
          },
        ]
      : value.result.sentences.flatMap((sentence, index) =>
          (["grammar", "expressions", "languageNotes"] as const).map((key) => ({
            source: sentence.sourceText,
            points: sentence[key],
            path: ["result", "sentences", index, key],
          })),
        );
  for (const group of groups)
    group.points.forEach((point, index) => {
      if (point.evidenceText !== undefined && !group.source.includes(point.evidenceText))
        context.addIssue({
          code: "custom",
          path: [...group.path, index, "evidenceText"],
          message: "Teaching evidence must match its exact source unit.",
        });
    });
}

export const structuredAnalysisContentSchema = contentObject.superRefine(validateStructuredContent);
export const structuredAnalysisRecordSchema = analysisRecordSchema
  .innerType()
  .extend(structuredContentFields)
  .superRefine((value, context) => {
    const { archivedAt, createdAt, id, revision, reviewState, updatedAt, ...content } = value;
    void [archivedAt, createdAt, id, revision, reviewState, updatedAt];
    validateStructuredContent(content, context);
    verify(context, () => validateStructuredPayloadBudget(value));
    verify(context, () =>
      validateStructuredPayloadBudget(
        analysisRecordSchema.parse({ ...value, result: legacyResult(value.result) }),
      ),
    );
  });
export type StructuredAnalysisContent = z.infer<typeof structuredAnalysisContentSchema>;
export type StructuredAnalysisRecord = z.infer<typeof structuredAnalysisRecordSchema>;
export const analysisContentReadSchema = z.union([
  analysisContentSchema,
  structuredAnalysisContentSchema,
]);
export const analysisRecordReadSchema = z.union([
  analysisRecordSchema,
  structuredAnalysisRecordSchema,
]);
export type AnalysisContentRead = z.infer<typeof analysisContentReadSchema>;
export type AnalysisRecordRead = z.infer<typeof analysisRecordReadSchema>;

export function projectAnalysisContentForLegacy(value: AnalysisContentRead): AnalysisContent {
  const parsed = analysisContentReadSchema.parse(value);
  if (
    parsed.result.type === "phrase-analysis-v2" ||
    parsed.result.type === "sentence-passage-analysis-v2"
  )
    return analysisContentSchema.parse(parsed);
  return analysisContentSchema.parse({ ...parsed, result: legacyResult(parsed.result) });
}
export function projectAnalysisRecordForLegacy(value: AnalysisRecordRead): AnalysisRecord {
  const parsed = analysisRecordReadSchema.parse(value);
  if (
    parsed.result.type === "phrase-analysis-v2" ||
    parsed.result.type === "sentence-passage-analysis-v2"
  )
    return analysisRecordSchema.parse(parsed);
  return analysisRecordSchema.parse({ ...parsed, result: legacyResult(parsed.result) });
}

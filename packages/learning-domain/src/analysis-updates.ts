import { z } from "zod/v3";
import {
  collocationSchema,
  commonPhraseSchema,
  confusableWordSchema,
  contextExampleSchema,
  contextualSenseSchema,
  coreMeaningSchema,
  dictionaryMeaningGroupSchema,
  partOfSpeechSchema,
  pronunciationSchema,
  relatedTermSchema,
  synonymComparisonSchema,
  usageNoteSchema,
  wordExplanationResultSchema,
  sentenceExplanationResultSchema,
} from "./analysis-results.js";
const requestIdSchema = z.string().trim().min(1).max(64);

const progressUpdateSchema = z.strictObject({
  requestId: requestIdSchema,
  stage: z.enum(["queued", "running"]),
  type: z.literal("progress"),
});

const deltaUpdateSchema = z.strictObject({
  requestId: requestIdSchema,
  section: z.enum([
    "context-role",
    "contextual-analysis",
    "contextual-meaning",
    "main-structure",
    "translation",
  ]),
  sequence: z.number().int().nonnegative().safe(),
  text: z.string().min(1).max(4_096),
  type: z.literal("delta"),
});

function sectionUpdate<Section extends string, Schema extends z.ZodType>(
  section: Section,
  value: Schema,
) {
  return z.strictObject({
    requestId: requestIdSchema,
    section: z.literal(section),
    sequence: z.number().int().nonnegative().safe(),
    type: z.literal("section"),
    value,
  });
}

const sectionUpdateSchema = z.discriminatedUnion("section", [
  sectionUpdate("key-expressions", sentenceExplanationResultSchema.shape.keyExpressions),
  sectionUpdate("base-form", z.string().trim().min(1).max(120)),
  sectionUpdate("collocations", z.array(collocationSchema).min(1).max(3)),
  sectionUpdate("common-meanings", z.array(dictionaryMeaningGroupSchema).min(1).max(4)),
  sectionUpdate("common-phrases", z.array(commonPhraseSchema).min(1).max(4)),
  sectionUpdate("confusable-words", z.array(confusableWordSchema).min(1).max(4)),
  sectionUpdate("context-example", contextExampleSchema),
  sectionUpdate("contextual-sense", contextualSenseSchema),
  sectionUpdate("core-meanings", z.array(coreMeaningSchema).min(1).max(3)),
  sectionUpdate("part-of-speech", partOfSpeechSchema),
  sectionUpdate("pronunciation", pronunciationSchema),
  sectionUpdate("similar-terms", z.array(relatedTermSchema).min(1).max(3)),
  sectionUpdate("synonym-comparisons", z.array(synonymComparisonSchema).min(1).max(3)),
  sectionUpdate("synonyms", z.array(relatedTermSchema).min(1).max(3)),
  sectionUpdate("usage-notes", z.array(usageNoteSchema).min(1).max(3)),
  sectionUpdate("word-form", wordExplanationResultSchema.shape.wordForm),
  sectionUpdate("word-formation", z.string().trim().min(1).max(500)),
]);

export const analysisUpdateSchema = z.union([
  progressUpdateSchema,
  deltaUpdateSchema,
  sectionUpdateSchema,
]);
export type AnalysisUpdate = z.infer<typeof analysisUpdateSchema>;

import { z } from "zod";

import { analysisErrorSchema } from "./errors.js";
import {
  MAX_COLLOCATIONS,
  MAX_CORE_MEANINGS,
  MAX_RELATED_TERMS,
  MAX_STREAM_DELTA_LENGTH,
  SCHEMA_VERSION,
} from "./limits.js";
import { requestIdSchema } from "./requests.js";
import {
  analysisResultSchema,
  collocationSchema,
  contextExampleSchema,
  coreMeaningSchema,
  lexicalExplanationResultSchema,
  partOfSpeechSchema,
  pronunciationSchema,
  relatedTermSchema,
  type Collocation,
  type ContextExample,
  type CoreMeaning,
  type PartOfSpeech,
  type Pronunciation,
  type RelatedTerm,
} from "./results.js";

const schemaVersionSchema = z.literal(SCHEMA_VERSION);

export const modelProviderSchema = z.enum(["codex", "openai-responses", "openai-compatible-http"]);
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const healthResultEventSchema = z
  .strictObject({
    codexVersion: z.string().trim().min(1).max(120).nullable(),
    hostVersion: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(120),
    provider: modelProviderSchema,
    ready: z.literal(true),
    requestId: requestIdSchema,
    schemaVersion: z.literal(SCHEMA_VERSION),
    type: z.literal("health-result"),
  })
  .superRefine((value, context) => {
    if (value.provider === "codex" && value.codexVersion === null) {
      context.addIssue({ code: "custom", message: "Codex health requires a version." });
    }
    if (value.provider !== "codex" && value.codexVersion !== null) {
      context.addIssue({ code: "custom", message: "HTTP health must not report Codex." });
    }
  });
export type HealthResultEvent = z.infer<typeof healthResultEventSchema>;

export const warmupReadyEventSchema = z.strictObject({
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("warmup-ready"),
});
export type WarmupReadyEvent = z.infer<typeof warmupReadyEventSchema>;

export const progressEventSchema = z.strictObject({
  elapsedMs: z.number().int().nonnegative().optional(),
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  stage: z.enum(["queued", "running"]),
  type: z.literal("progress"),
});
export type ProgressEvent = z.infer<typeof progressEventSchema>;

export const resultEventSchema = z.strictObject({
  requestId: requestIdSchema,
  result: analysisResultSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("result"),
});
export type ResultEvent = z.infer<typeof resultEventSchema>;

export const analysisDeltaSectionSchema = z.enum([
  "contextual-meaning",
  "translation",
  "main-structure",
  "context-role",
]);
export type AnalysisDeltaSection = z.infer<typeof analysisDeltaSectionSchema>;

const analysisSequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const analysisDeltaEventSchema = z.strictObject({
  delta: z.string().min(1).max(MAX_STREAM_DELTA_LENGTH),
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  section: analysisDeltaSectionSchema,
  sequence: analysisSequenceSchema,
  type: z.literal("analysis-delta"),
});
export type AnalysisDeltaEvent = z.infer<typeof analysisDeltaEventSchema>;

export type AnalysisSectionPayload =
  | { section: "part-of-speech"; value: PartOfSpeech }
  | { section: "pronunciation"; value: Pronunciation }
  | { section: "base-form"; value: string }
  | { section: "word-formation"; value: string }
  | { section: "core-meanings"; value: CoreMeaning[] }
  | { section: "collocations"; value: Collocation[] }
  | { section: "context-example"; value: ContextExample }
  | { section: "similar-terms"; value: RelatedTerm[] }
  | { section: "synonyms"; value: RelatedTerm[] };

const analysisSectionCommonShape = {
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  sequence: analysisSequenceSchema,
  type: z.literal("analysis-section"),
};
const baseFormSchema = lexicalExplanationResultSchema.shape.baseForm.unwrap();
const wordFormationSchema = lexicalExplanationResultSchema.shape.wordFormation.unwrap();

const partOfSpeechSectionEventSchema = z.strictObject({
  ...analysisSectionCommonShape,
  section: z.literal("part-of-speech"),
  value: partOfSpeechSchema,
});
const pronunciationSectionEventSchema = z.strictObject({
  ...analysisSectionCommonShape,
  section: z.literal("pronunciation"),
  value: pronunciationSchema,
});
const baseFormSectionEventSchema = z.strictObject({
  ...analysisSectionCommonShape,
  section: z.literal("base-form"),
  value: baseFormSchema,
});
const wordFormationSectionEventSchema = z.strictObject({
  ...analysisSectionCommonShape,
  section: z.literal("word-formation"),
  value: wordFormationSchema,
});
const coreMeaningsSectionEventSchema = z.strictObject({
  ...analysisSectionCommonShape,
  section: z.literal("core-meanings"),
  value: z.array(coreMeaningSchema).min(1).max(MAX_CORE_MEANINGS),
});
const collocationsSectionEventSchema = z.strictObject({
  ...analysisSectionCommonShape,
  section: z.literal("collocations"),
  value: z.array(collocationSchema).min(1).max(MAX_COLLOCATIONS),
});
const contextExampleSectionEventSchema = z.strictObject({
  ...analysisSectionCommonShape,
  section: z.literal("context-example"),
  value: contextExampleSchema,
});
const similarTermsSectionEventSchema = z.strictObject({
  ...analysisSectionCommonShape,
  section: z.literal("similar-terms"),
  value: z.array(relatedTermSchema).min(1).max(MAX_RELATED_TERMS),
});
const synonymsSectionEventSchema = z.strictObject({
  ...analysisSectionCommonShape,
  section: z.literal("synonyms"),
  value: z.array(relatedTermSchema).min(1).max(MAX_RELATED_TERMS),
});

export const analysisSectionEventSchema = z.discriminatedUnion("section", [
  partOfSpeechSectionEventSchema,
  pronunciationSectionEventSchema,
  baseFormSectionEventSchema,
  wordFormationSectionEventSchema,
  coreMeaningsSectionEventSchema,
  collocationsSectionEventSchema,
  contextExampleSectionEventSchema,
  similarTermsSectionEventSchema,
  synonymsSectionEventSchema,
]);
export type AnalysisSectionEvent = z.infer<typeof analysisSectionEventSchema>;

export const wordbookPresenceSchema = z.enum(["present", "absent"]);
export type WordbookPresence = z.infer<typeof wordbookPresenceSchema>;

export const wordStatusEventSchema = z.strictObject({
  presence: wordbookPresenceSchema,
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("word-status"),
});
export type WordStatusEvent = z.infer<typeof wordStatusEventSchema>;

export const wordbookAddOutcomeSchema = z.enum(["added", "already-exists"]);
export type WordbookAddOutcome = z.infer<typeof wordbookAddOutcomeSchema>;

export const wordAddedEventSchema = z.strictObject({
  outcome: wordbookAddOutcomeSchema,
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("word-added"),
});
export type WordAddedEvent = z.infer<typeof wordAddedEventSchema>;

export const errorEventSchema = z.strictObject({
  error: analysisErrorSchema,
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("error"),
});
export type ErrorEvent = z.infer<typeof errorEventSchema>;

export const hostEventSchema = z.discriminatedUnion("type", [
  healthResultEventSchema,
  warmupReadyEventSchema,
  progressEventSchema,
  analysisDeltaEventSchema,
  analysisSectionEventSchema,
  resultEventSchema,
  wordStatusEventSchema,
  wordAddedEventSchema,
  errorEventSchema,
]);
export type HostEvent = z.infer<typeof hostEventSchema>;

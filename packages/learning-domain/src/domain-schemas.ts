import { z } from "zod/v3";

import { canonicalKeyForContent, normalizeHeadword } from "./normalization.js";

const idSchema = z.string().trim().min(1).max(128);
const instantSchema = z.string().datetime({ offset: true });
const textSchema = z.string().trim().min(1).max(4_000);
const zhTextSchema = textSchema;
const sourceTypeSchema = z.enum([
  "manual",
  "study-capture",
  "web-selection",
  "youtube-caption",
  "eudic",
  "extension-collection",
  "extension-local-import",
]);
const resourceFields = {
  createdAt: instantSchema,
  id: idSchema,
  revision: z.number().int().min(1),
  updatedAt: instantSchema,
};

export const expressionSchema = z.strictObject({
  meaningZh: zhTextSchema,
  register: z.enum(["neutral", "formal", "informal", "literary", "spoken"]).optional(),
  text: textSchema.max(500),
  type: z.literal("expression"),
  usageZh: zhTextSchema,
});
export type Expression = z.infer<typeof expressionSchema>;

export const sentencePatternSchema = z
  .strictObject({
    functionZh: zhTextSchema,
    slots: z
      .array(
        z.strictObject({
          descriptionZh: zhTextSchema.max(500),
          name: z
            .string()
            .trim()
            .regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/u),
        }),
      )
      .min(1)
      .max(12),
    template: textSchema.max(500),
    type: z.literal("sentence_pattern"),
    usageZh: zhTextSchema,
  })
  .superRefine((pattern, context) => {
    const names = pattern.slots.map((slot) => slot.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Slot names must be unique." });
    }
    const placeholders = [...pattern.template.matchAll(/\{([^{}]+)\}/gu)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined);
    if (placeholders.length === 0 || placeholders.some((name) => !names.includes(name))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Template placeholders must reference declared slots.",
      });
    }
    if (names.some((name) => !placeholders.includes(name))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Every slot must appear in the template.",
      });
    }
  });
export type SentencePattern = z.infer<typeof sentencePatternSchema>;

export const learningItemContentSchema = z.union([expressionSchema, sentencePatternSchema]);
export type LearningItemContent = z.infer<typeof learningItemContentSchema>;

export const sourceExampleSchema = z.strictObject({
  analysisUnitId: z
    .string()
    .regex(/^u(?:[1-9]|[1-3]\d|40)$/u)
    .optional(),
  analysisId: idSchema.optional(),
  id: idSchema,
  sourceText: textSchema.max(2_000),
  sourceTitle: z.string().trim().min(1).max(500).optional(),
  sourceType: z.enum(["manual", "study-capture"]),
  translationZh: zhTextSchema.optional(),
});
export type SourceExample = z.infer<typeof sourceExampleSchema>;

const analysisUnitIdSchema = z.string().regex(/^u(?:[1-9]|[1-3]\d|40)$/u);
const candidateCommon = {
  analysisUnitId: analysisUnitIdSchema,
  id: idSchema,
  ordinal: z.number().int().min(0).max(199),
};
export const candidateSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...candidateCommon, payload: expressionSchema, type: z.literal("expression") }),
  z.strictObject({
    ...candidateCommon,
    payload: sentencePatternSchema,
    type: z.literal("sentence-pattern"),
  }),
]);
export type Candidate = z.infer<typeof candidateSchema>;

export const generatedExampleSchema = z.strictObject({
  sourceText: textSchema.max(500),
  translationZh: zhTextSchema.max(1_000),
});
export const teachingPointSchema = z.strictObject({
  commonMistakeZh: zhTextSchema.max(1_000).optional(),
  evidenceText: textSchema.max(500).optional(),
  explanationZh: zhTextSchema.max(2_000),
  generatedExample: generatedExampleSchema.optional(),
  label: textSchema.max(120),
});
export const phraseAnalysisSchema = z
  .strictObject({
    analysisUnitId: z.literal("u1"),
    candidateIds: z.array(idSchema).max(20),
    contextualMeaningZh: zhTextSchema,
    register: z.string().trim().min(1).max(200).optional(),
    structureAndCollocationZh: z.array(zhTextSchema.max(1_000)).max(20),
    translationZh: zhTextSchema,
    type: z.literal("phrase-analysis-v2"),
    usageNotes: z.array(teachingPointSchema).max(20),
  })
  .refine((value) => new Set(value.candidateIds).size === value.candidateIds.length, {
    message: "Candidate ids must be unique.",
  });
export const sentencePassageAnalysisSchema = z
  .strictObject({
    overall: z.strictObject({
      contextAndToneZh: zhTextSchema.optional(),
      translationZh: zhTextSchema,
      understandingZh: zhTextSchema,
    }),
    sentences: z
      .array(
        z.strictObject({
          analysisUnitId: analysisUnitIdSchema,
          candidateIds: z.array(idSchema).max(20),
          expressions: z.array(teachingPointSchema).max(20),
          grammar: z.array(teachingPointSchema).max(20),
          languageNotes: z.array(teachingPointSchema).max(20),
          ordinal: z.number().int().min(0).max(39),
          sourceText: textSchema.max(2_000),
          structure: z.array(teachingPointSchema).max(20),
          translationZh: zhTextSchema,
        }),
      )
      .min(1)
      .max(40),
    type: z.literal("sentence-passage-analysis-v2"),
  })
  .superRefine((analysis, context) => {
    analysis.sentences.forEach((sentence, index) => {
      if (sentence.analysisUnitId !== `u${index + 1}` || sentence.ordinal !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Analysis unit ids and ordinals must be contiguous and ordered.",
        });
      }
      if (new Set(sentence.candidateIds).size !== sentence.candidateIds.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Candidate ids must be unique." });
      }
    });
  });
export const webDeepAnalysisSchema = z.union([phraseAnalysisSchema, sentencePassageAnalysisSchema]);
export type WebDeepAnalysis = z.infer<typeof webDeepAnalysisSchema>;

export const modelMetadataSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  model: z.string().trim().min(1).max(200),
  outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  promptVersion: z.string().trim().min(1).max(64),
  provider: z.enum(["deepseek", "openai"]),
  schemaVersion: z.number().int().min(1),
});
const analysisContentObjectSchema = z.strictObject({
  candidates: z.array(candidateSchema).max(200),
  modelMetadata: modelMetadataSchema,
  result: webDeepAnalysisSchema,
  selectionKind: z.enum(["phrase", "sentence", "passage"]),
  source: z.strictObject({
    title: z.string().trim().min(1).max(500).optional(),
    type: z.enum(["manual", "study-capture"]),
    userContext: z.string().trim().min(1).max(1_000).optional(),
  }),
  sourceNormalizedHash: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceText: textSchema.max(2_000),
  studyCaptureId: idSchema.optional(),
});

export type AnalysisContent = z.infer<typeof analysisContentObjectSchema>;

function validateAnalysisContent(record: AnalysisContent, context: z.RefinementCtx): void {
  if (
    (record.result.type === "phrase-analysis-v2" && record.selectionKind !== "phrase") ||
    (record.result.type === "sentence-passage-analysis-v2" &&
      record.selectionKind !== "sentence" &&
      record.selectionKind !== "passage")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Analysis result must match its selection kind.",
    });
  }
  const ids = record.candidates.map((candidate) => candidate.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Candidate ids must be unique." });
  }
  record.candidates.forEach((candidate, index) => {
    if (candidate.ordinal !== index) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Candidate ordinals must be contiguous and ordered.",
      });
    }
  });
  const referenced = new Map<string, string[]>();
  const units =
    record.result.type === "phrase-analysis-v2"
      ? [{ analysisUnitId: record.result.analysisUnitId, candidateIds: record.result.candidateIds }]
      : record.result.sentences;
  for (const unit of units) {
    for (const candidateId of unit.candidateIds) {
      referenced.set(candidateId, [...(referenced.get(candidateId) ?? []), unit.analysisUnitId]);
    }
  }
  for (const candidate of record.candidates) {
    const unitIds = referenced.get(candidate.id) ?? [];
    if (unitIds.length !== 1 || unitIds[0] !== candidate.analysisUnitId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Every candidate must be referenced once by its analysis unit.",
      });
    }
  }
  if (
    record.result.type === "phrase-analysis-v2" &&
    record.candidates.some((candidate) => candidate.type !== "expression")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Phrase candidates are expressions.",
    });
  }
  if ([...referenced.keys()].some((id) => !ids.includes(id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown candidate reference." });
  }
}

export const analysisContentSchema =
  analysisContentObjectSchema.superRefine(validateAnalysisContent);
export const analysisRecordSchema = z
  .strictObject({
    ...resourceFields,
    ...analysisContentObjectSchema.shape,
    archivedAt: instantSchema.nullable(),
    reviewState: z.enum(["pendingReview", "reviewed"]),
  })
  .superRefine(validateAnalysisContent);
export type AnalysisRecord = z.infer<typeof analysisRecordSchema>;

export const studyCaptureSchema = z.strictObject({
  captureCount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  createdAt: instantSchema,
  firstCapturedAt: instantSchema,
  id: idSchema,
  kind: z.enum(["phrase", "sentence", "passage"]),
  lastCapturedAt: instantSchema,
  normalizedTextHash: z.string().regex(/^[a-f0-9]{64}$/u),
  revision: z.number().int().min(1),
  sourceText: textSchema.max(2_000),
  status: z.enum(["pending", "analyzing", "analyzed"]),
  title: z.string().trim().min(1).max(500).optional(),
  updatedAt: instantSchema,
  userContext: z.string().trim().min(1).max(1_000).optional(),
});
export type StudyCapture = z.infer<typeof studyCaptureSchema>;

export const contextObservationSchema = z.strictObject({
  contextualMeaningZh: zhTextSchema.optional(),
  id: idSchema,
  observedAt: instantSchema,
  sourceText: textSchema.max(2_000).optional(),
  sourceTitle: z.string().trim().min(1).max(500).optional(),
  sourceType: sourceTypeSchema,
});
export type ContextObservation = z.infer<typeof contextObservationSchema>;

export const wordEntrySchema = z
  .strictObject({
    ...resourceFields,
    canonicalKey: z.string().min(1).max(500),
    contexts: z.array(contextObservationSchema).max(10_000),
    headword: z.string().trim().min(1).max(200),
    notes: z.string().max(4_000).optional(),
  })
  .refine((entry) => entry.canonicalKey === normalizeHeadword(entry.headword), {
    message: "Word canonical key must match its headword.",
  })
  .refine(
    (entry) => new Set(entry.contexts.map((context) => context.id)).size === entry.contexts.length,
    { message: "Word context ids must be unique." },
  );
export type WordEntry = z.infer<typeof wordEntrySchema>;

export const learningItemSchema = z
  .strictObject({
    ...resourceFields,
    canonicalKey: z.string().min(1).max(500),
    content: learningItemContentSchema,
    sourceExamples: z.array(sourceExampleSchema).max(10_000),
    systemAttributes: z.array(z.string().trim().min(1).max(100)).max(50),
    tags: z.array(z.string().trim().min(1).max(100)).max(50),
    type: z.enum(["expression", "sentence-pattern"]),
  })
  .refine(
    (item) =>
      (item.type === "expression" && item.content.type === "expression") ||
      (item.type === "sentence-pattern" && item.content.type === "sentence_pattern"),
    { message: "Learning item type must match its content variant." },
  )
  .refine((item) => item.canonicalKey === canonicalKeyForContent(item.content), {
    message: "Learning item canonical key must match its content.",
  })
  .refine(
    (item) =>
      new Set(item.sourceExamples.map((source) => source.id)).size === item.sourceExamples.length,
    { message: "Source example ids must be unique." },
  )
  .refine((item) => new Set(item.tags).size === item.tags.length, {
    message: "Tags must be unique.",
  })
  .refine((item) => new Set(item.systemAttributes).size === item.systemAttributes.length, {
    message: "System attributes must be unique.",
  });
export type LearningItem = z.infer<typeof learningItemSchema>;

import { z } from "zod/v3";

import { storeAnalysisResultSchema } from "./analysis-results.js";
import { canonicalKeyForContent, normalizeHeadword } from "./normalization.js";

const idSchema = z.string().trim().min(1).max(128);
const instantSchema = z.string().datetime({ offset: true });
const textSchema = z.string().trim().min(1).max(4_000);
const zhTextSchema = textSchema;
const sourceTypeSchema = z.enum(["manual", "web-selection", "youtube-caption", "eudic"]);
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
  analysisId: idSchema.optional(),
  id: idSchema,
  sentenceId: z
    .string()
    .regex(/^s[1-9]\d*$/u)
    .optional(),
  sourceText: textSchema.max(2_000),
  sourceTitle: z.string().trim().min(1).max(500).optional(),
  sourceType: sourceTypeSchema.exclude(["eudic"]),
  translationZh: zhTextSchema.optional(),
});
export type SourceExample = z.infer<typeof sourceExampleSchema>;

export const wordCandidatePayloadSchema = z.strictObject({
  contextualMeaningZh: zhTextSchema.optional(),
  headword: z.string().trim().min(1).max(200),
  type: z.literal("word"),
});
const candidateCommon = {
  id: idSchema,
  ordinal: z.number().int().min(0).max(199),
  sentenceId: z.string().regex(/^s[1-9]\d*$/u),
};
export const candidateSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...candidateCommon,
    payload: wordCandidatePayloadSchema,
    type: z.literal("word"),
  }),
  z.strictObject({ ...candidateCommon, payload: expressionSchema, type: z.literal("expression") }),
  z.strictObject({
    ...candidateCommon,
    payload: sentencePatternSchema,
    type: z.literal("sentence-pattern"),
  }),
]);
export type Candidate = z.infer<typeof candidateSchema>;

export const passageAnalysisSchema = z
  .strictObject({
    overall: z.strictObject({
      contextAndToneZh: zhTextSchema.optional(),
      translationZh: zhTextSchema,
      understandingZh: zhTextSchema,
    }),
    schemaVersion: z.literal(1),
    sentences: z
      .array(
        z.strictObject({
          candidateIds: z.array(idSchema).max(20),
          grammarNotes: z
            .array(z.strictObject({ explanationZh: zhTextSchema, label: textSchema.max(120) }))
            .max(20),
          id: z.string().regex(/^s[1-9]\d*$/u),
          ordinal: z.number().int().min(0).max(39),
          sourceText: textSchema.max(2_000),
          structureZh: zhTextSchema,
          translationZh: zhTextSchema,
        }),
      )
      .min(1)
      .max(40),
  })
  .superRefine((analysis, context) => {
    analysis.sentences.forEach((sentence, index) => {
      if (sentence.id !== `s${index + 1}` || sentence.ordinal !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sentence ids and ordinals must be contiguous and ordered.",
        });
      }
      if (new Set(sentence.candidateIds).size !== sentence.candidateIds.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Candidate ids must be unique." });
      }
    });
  });
export type PassageAnalysis = z.infer<typeof passageAnalysisSchema>;

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
  result: z.union([passageAnalysisSchema, storeAnalysisResultSchema]),
  selectionKind: z.enum(["word", "phrase", "sentence", "passage"]),
  source: z.strictObject({
    title: z.string().trim().min(1).max(500).optional(),
    type: sourceTypeSchema.exclude(["eudic"]),
  }),
  sourceText: textSchema.max(2_000),
});

type AnalysisContent = z.infer<typeof analysisContentObjectSchema>;

function validateAnalysisContent(record: AnalysisContent, context: z.RefinementCtx): void {
  if (!("sentences" in record.result)) {
    if (record.selectionKind !== record.result.selectionKind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Record selection kind must match its result.",
      });
    }
    if (record.sourceText !== record.result.sourceText) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Record source text must match its trusted result envelope.",
      });
    }
    if (record.candidates.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Legacy Store results cannot carry unreferenced Cloud candidates.",
      });
    }
    return;
  }
  if (record.selectionKind !== "sentence" && record.selectionKind !== "passage") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Structured passage results require sentence or passage input.",
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
  for (const sentence of record.result.sentences) {
    for (const candidateId of sentence.candidateIds) {
      referenced.set(candidateId, [...(referenced.get(candidateId) ?? []), sentence.id]);
    }
  }
  for (const candidate of record.candidates) {
    const sentenceIds = referenced.get(candidate.id) ?? [];
    if (sentenceIds.length !== 1 || sentenceIds[0] !== candidate.sentenceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Every candidate must be referenced once by its sentence.",
      });
    }
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

import { z } from "zod/v3";

import { MAX_CONTEXT_SENTENCE_LENGTH } from "./normalization.js";

export const MAX_MODEL_TEXT_LENGTH = 4_000;
export const MAX_STREAM_DELTA_LENGTH = 4_096;
export const MAX_ANALYSIS_JSON_BYTES = 1_048_576;

const chineseTextSchema = z.string().trim().min(1).max(MAX_MODEL_TEXT_LENGTH);
function chineseText(maximum: number): z.ZodEffects<z.ZodString> {
  return z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => /[\u3400-\u9fff]/u.test(value), "Expected Chinese text.");
}
function englishText(maximum: number): z.ZodEffects<z.ZodEffects<z.ZodString>> {
  return z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => /[A-Za-z]/u.test(value), "Expected English text.")
    .refine((value) => !/[\u3400-\u9fff]/u.test(value), "Expected English text.");
}

export const partOfSpeechSchema = z.enum([
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "interjection",
  "determiner",
  "modal",
  "number",
  "particle",
  "phrase",
  "other",
]);
export type PartOfSpeech = z.infer<typeof partOfSpeechSchema>;

export const relatedTermSchema = z.strictObject({
  meaningZh: chineseTextSchema.max(200),
  partOfSpeech: partOfSpeechSchema,
  text: englishText(120),
});
export type RelatedTerm = z.infer<typeof relatedTermSchema>;
export const collocationSchema = z.strictObject({
  meaningZh: chineseTextSchema.max(300),
  text: englishText(200),
});
export type Collocation = z.infer<typeof collocationSchema>;
export const pronunciationSchema = z
  .strictObject({
    uk: z.string().trim().min(1).max(120).optional(),
    us: z.string().trim().min(1).max(120).optional(),
  })
  .refine((value) => value.uk !== undefined || value.us !== undefined);
export type Pronunciation = z.infer<typeof pronunciationSchema>;
export const contextExampleSchema = z.strictObject({
  english: englishText(MAX_CONTEXT_SENTENCE_LENGTH),
  translationZh: chineseTextSchema,
});
export const contextualSenseSchema = z.strictObject({
  meaningZh: chineseText(300),
  partOfSpeech: partOfSpeechSchema,
});
export const dictionaryMeaningGroupSchema = z.strictObject({
  meaningsZh: z.array(chineseText(300)).min(1).max(3),
  partOfSpeech: partOfSpeechSchema,
});
export const commonPhraseSchema = z.strictObject({
  meaningZh: chineseText(300),
  text: englishText(200),
});
export const confusableWordSchema = z.strictObject({
  distinctionZh: chineseText(500),
  meaningZh: chineseText(200),
  partOfSpeech: partOfSpeechSchema,
  text: englishText(120),
});
export const coreMeaningSchema = z.strictObject({
  meaningZh: chineseTextSchema.max(300),
  partOfSpeech: partOfSpeechSchema,
});
export const usageNoteSchema = z.strictObject({
  descriptionZh: chineseText(500),
  titleZh: chineseText(120),
});
export const synonymComparisonSchema = z.strictObject({
  distinctionZh: chineseText(500),
  meaningZh: chineseText(200),
  partOfSpeech: partOfSpeechSchema,
  text: englishText(120),
});
const trustedResultFields = {
  requestId: z.string().trim().min(1).max(64),
  sourceText: z.string().trim().min(1).max(MAX_CONTEXT_SENTENCE_LENGTH),
};

export const wordTranslationResultSchema = z.strictObject({
  ...trustedResultFields,
  commonMeanings: z.array(dictionaryMeaningGroupSchema).min(1).max(4),
  commonPhrases: z.array(commonPhraseSchema).max(4),
  confusableWords: z.array(confusableWordSchema).max(4),
  contextualSense: contextualSenseSchema,
  dictionaryForm: englishText(120),
  pronunciation: pronunciationSchema.optional(),
  selectionKind: z.literal("word"),
  type: z.literal("translate-word"),
});
export const lexicalTranslationResultSchema = z.strictObject({
  ...trustedResultFields,
  collocations: z.array(collocationSchema).max(3),
  contextExample: contextExampleSchema.optional(),
  contextualMeaningZh: chineseTextSchema,
  partOfSpeech: partOfSpeechSchema,
  pronunciation: pronunciationSchema.optional(),
  selectionKind: z.literal("phrase"),
  similarTerms: z.array(relatedTermSchema).max(3),
  type: z.literal("translate-lexical"),
});
export const passageTranslationResultSchema = z.strictObject({
  ...trustedResultFields,
  selectionKind: z.enum(["sentence", "passage"]),
  translationZh: chineseTextSchema,
  type: z.literal("translate-passage"),
});
export const lexicalExplanationResultSchema = z.strictObject({
  ...trustedResultFields,
  baseForm: englishText(120).optional(),
  collocations: z.array(collocationSchema).max(3),
  contextualMeaningZh: chineseTextSchema,
  coreMeanings: z.array(coreMeaningSchema).min(1).max(3),
  selectionKind: z.literal("phrase"),
  synonyms: z.array(relatedTermSchema).max(3),
  type: z.literal("explain-lexical"),
  wordFormation: z.string().trim().min(1).max(300).optional(),
});
export const wordExplanationResultSchema = z.strictObject({
  ...trustedResultFields,
  contextualAnalysisZh: chineseText(MAX_MODEL_TEXT_LENGTH),
  selectionKind: z.literal("word"),
  synonyms: z.array(synonymComparisonSchema).max(3),
  type: z.literal("explain-word"),
  usageNotes: z.array(usageNoteSchema).max(3),
  wordForm: z.strictObject({
    baseForm: englishText(120),
    formTypeZh: chineseText(300),
    sentenceRoleZh: chineseText(500).optional(),
  }),
  wordFormationZh: chineseText(500).optional(),
});
export const sentenceExplanationResultSchema = z.strictObject({
  ...trustedResultFields,
  contextRole: chineseTextSchema,
  keyExpressions: z
    .array(z.strictObject({ meaningZh: chineseTextSchema.max(500), text: englishText(300) }))
    .min(1)
    .max(6),
  mainStructure: z.string().trim().min(1).max(MAX_MODEL_TEXT_LENGTH),
  selectionKind: z.enum(["sentence", "passage"]),
  translationZh: chineseTextSchema,
  type: z.literal("explain-sentence"),
});
export const storeAnalysisResultSchema = z.discriminatedUnion("type", [
  wordTranslationResultSchema,
  wordExplanationResultSchema,
  lexicalTranslationResultSchema,
  passageTranslationResultSchema,
  lexicalExplanationResultSchema,
  sentenceExplanationResultSchema,
]);
export type StoreAnalysisResult = z.infer<typeof storeAnalysisResultSchema>;

import { z } from "zod";

import {
  MAX_COLLOCATIONS,
  MAX_CONTEXT_LENGTH,
  MAX_MODEL_TEXT_LENGTH,
  MAX_RELATED_TERMS,
  MAX_SELECTION_LENGTH,
  MIN_COLLOCATIONS,
  MIN_RELATED_TERMS,
} from "./limits.js";

const chineseTextSchema = z.string().trim().min(1).max(MAX_MODEL_TEXT_LENGTH);
const englishTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CONTEXT_LENGTH)
  .refine((value) => /[A-Za-z]/.test(value), "Expected English text.")
  .refine((value) => !/[\u3400-\u9fff]/.test(value), "Expected English text.");
const sourceTextSchema = z.string().trim().min(1).max(MAX_SELECTION_LENGTH);

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
  text: englishTextSchema.max(120),
});
export type RelatedTerm = z.infer<typeof relatedTermSchema>;

export const collocationSchema = z.strictObject({
  meaningZh: chineseTextSchema.max(300),
  text: englishTextSchema.max(200),
});
export type Collocation = z.infer<typeof collocationSchema>;

const lexicalKindSchema = z.enum(["word", "phrase"]);
const passageKindSchema = z.enum(["sentence", "paragraph"]);

const pronunciationSchema = z
  .strictObject({
    uk: z.string().trim().min(1).max(120).optional(),
    us: z.string().trim().min(1).max(120).optional(),
  })
  .refine((value) => value.uk !== undefined || value.us !== undefined, {
    message: "At least one pronunciation is required.",
  });

const contextExampleSchema = z.strictObject({
  english: englishTextSchema,
  translationZh: chineseTextSchema,
});

export const lexicalTranslationResultSchema = z.strictObject({
  collocations: z.array(collocationSchema).min(MIN_COLLOCATIONS).max(MAX_COLLOCATIONS),
  contextExample: contextExampleSchema.optional(),
  contextualMeaningZh: chineseTextSchema,
  partOfSpeech: partOfSpeechSchema,
  pronunciation: pronunciationSchema.optional(),
  selectionKind: lexicalKindSchema,
  similarTerms: z.array(relatedTermSchema).min(MIN_RELATED_TERMS).max(MAX_RELATED_TERMS),
  sourceText: sourceTextSchema,
  type: z.literal("translate-lexical"),
});
export type LexicalTranslationResult = z.infer<typeof lexicalTranslationResultSchema>;

export const passageTranslationResultSchema = z.strictObject({
  selectionKind: passageKindSchema,
  sourceText: sourceTextSchema,
  translationZh: chineseTextSchema,
  type: z.literal("translate-passage"),
});
export type PassageTranslationResult = z.infer<typeof passageTranslationResultSchema>;

const coreMeaningSchema = z.strictObject({
  meaningZh: chineseTextSchema.max(300),
  partOfSpeech: partOfSpeechSchema,
});

export const lexicalExplanationResultSchema = z.strictObject({
  baseForm: englishTextSchema.max(120).optional(),
  collocations: z.array(collocationSchema).min(MIN_COLLOCATIONS).max(MAX_COLLOCATIONS),
  contextualMeaningZh: chineseTextSchema,
  coreMeanings: z.array(coreMeaningSchema).min(1).max(4),
  selectionKind: lexicalKindSchema,
  sourceText: sourceTextSchema,
  synonyms: z.array(relatedTermSchema).min(MIN_RELATED_TERMS).max(MAX_RELATED_TERMS),
  type: z.literal("explain-lexical"),
  wordFormation: z.string().trim().min(1).max(300).optional(),
});
export type LexicalExplanationResult = z.infer<typeof lexicalExplanationResultSchema>;

const keyExpressionSchema = z.strictObject({
  meaningZh: chineseTextSchema.max(500),
  text: englishTextSchema.max(300),
});

export const sentenceExplanationResultSchema = z.strictObject({
  contextRole: chineseTextSchema,
  keyExpressions: z.array(keyExpressionSchema).min(1).max(6),
  mainStructure: z.string().trim().min(1).max(MAX_MODEL_TEXT_LENGTH),
  selectionKind: z.literal("sentence"),
  sourceText: sourceTextSchema,
  translationZh: chineseTextSchema,
  type: z.literal("explain-sentence"),
});
export type SentenceExplanationResult = z.infer<typeof sentenceExplanationResultSchema>;

export const analysisResultSchema = z.discriminatedUnion("type", [
  lexicalTranslationResultSchema,
  passageTranslationResultSchema,
  lexicalExplanationResultSchema,
  sentenceExplanationResultSchema,
]);
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

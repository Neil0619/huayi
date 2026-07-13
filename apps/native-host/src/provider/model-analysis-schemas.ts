import {
  MAX_COLLOCATIONS,
  MAX_CONTEXT_LENGTH,
  MAX_CORE_MEANINGS,
  MAX_MODEL_TEXT_LENGTH,
  MAX_RELATED_TERMS,
  collocationSchema,
  coreMeaningSchema,
  partOfSpeechSchema,
  relatedTermSchema,
  type AnalysisResult,
  type AnalyzeRequest,
  type Collocation,
  type CoreMeaning,
  type PartOfSpeech,
  type RelatedTerm,
} from "@huayi/protocol";
import { z } from "zod";

const chineseTextSchema = z.string().trim().min(1).max(MAX_MODEL_TEXT_LENGTH);
const englishTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CONTEXT_LENGTH)
  .refine((value) => /[A-Za-z]/.test(value), "Expected English text.")
  .refine((value) => !/[\u3400-\u9fff]/.test(value), "Expected English text.");
const nullablePronunciationSchema = z
  .strictObject({
    uk: z.string().trim().min(1).max(120).nullable(),
    us: z.string().trim().min(1).max(120).nullable(),
  })
  .nullable();
const keyExpressionSchema = z.strictObject({
  meaningZh: chineseTextSchema.max(500),
  text: englishTextSchema.max(300),
});

export interface ModelLexicalTranslation {
  contextualMeaningZh: string;
  partOfSpeech: PartOfSpeech;
  pronunciation: { uk: string | null; us: string | null } | null;
  collocations: Collocation[];
  contextExampleTranslationZh: string | null;
  similarTerms: RelatedTerm[];
}

export interface ModelPassageTranslation {
  translationZh: string;
}

export interface ModelLexicalExplanation {
  contextualMeaningZh: string;
  baseForm: string | null;
  wordFormation: string | null;
  coreMeanings: CoreMeaning[];
  collocations: Collocation[];
  synonyms: RelatedTerm[];
}

export interface ModelSentenceExplanation {
  mainStructure: string;
  keyExpressions: { meaningZh: string; text: string }[];
  translationZh: string;
  contextRole: string;
}

export type ModelAnalysisResult =
  | ModelLexicalTranslation
  | ModelPassageTranslation
  | ModelLexicalExplanation
  | ModelSentenceExplanation;

export type ModelResultType = AnalysisResult["type"];

export const modelLexicalTranslationSchema = z.strictObject({
  contextualMeaningZh: chineseTextSchema,
  partOfSpeech: partOfSpeechSchema,
  pronunciation: nullablePronunciationSchema,
  collocations: z.array(collocationSchema).max(MAX_COLLOCATIONS),
  contextExampleTranslationZh: chineseTextSchema.nullable(),
  similarTerms: z.array(relatedTermSchema).max(MAX_RELATED_TERMS),
}) satisfies z.ZodType<ModelLexicalTranslation>;

export const modelPassageTranslationSchema = z.strictObject({
  translationZh: chineseTextSchema,
}) satisfies z.ZodType<ModelPassageTranslation>;

export const modelLexicalExplanationSchema = z.strictObject({
  contextualMeaningZh: chineseTextSchema,
  baseForm: englishTextSchema.max(120).nullable(),
  wordFormation: z.string().trim().min(1).max(300).nullable(),
  coreMeanings: z.array(coreMeaningSchema).min(1).max(MAX_CORE_MEANINGS),
  collocations: z.array(collocationSchema).max(MAX_COLLOCATIONS),
  synonyms: z.array(relatedTermSchema).max(MAX_RELATED_TERMS),
}) satisfies z.ZodType<ModelLexicalExplanation>;

export const modelSentenceExplanationSchema = z.strictObject({
  mainStructure: z.string().trim().min(1).max(MAX_MODEL_TEXT_LENGTH),
  keyExpressions: z.array(keyExpressionSchema).min(1).max(6),
  translationZh: chineseTextSchema,
  contextRole: chineseTextSchema,
}) satisfies z.ZodType<ModelSentenceExplanation>;

const MODEL_ANALYSIS_RESULT_SCHEMAS = {
  "explain-lexical": modelLexicalExplanationSchema,
  "explain-sentence": modelSentenceExplanationSchema,
  "translate-lexical": modelLexicalTranslationSchema,
  "translate-passage": modelPassageTranslationSchema,
} satisfies Record<ModelResultType, z.ZodType<ModelAnalysisResult>>;

const MODEL_ANALYSIS_FIELD_SCHEMAS: Record<ModelResultType, ReadonlyMap<string, z.ZodType>> = {
  "explain-lexical": new Map(Object.entries(modelLexicalExplanationSchema.shape)),
  "explain-sentence": new Map(Object.entries(modelSentenceExplanationSchema.shape)),
  "translate-lexical": new Map(Object.entries(modelLexicalTranslationSchema.shape)),
  "translate-passage": new Map(Object.entries(modelPassageTranslationSchema.shape)),
};

export function resultTypeFor(
  request: Pick<AnalyzeRequest, "action" | "selectionKind">,
): ModelResultType {
  const lexical = request.selectionKind === "word" || request.selectionKind === "phrase";
  if (request.action === "translate") return lexical ? "translate-lexical" : "translate-passage";
  if (lexical) return "explain-lexical";
  if (request.selectionKind === "sentence") return "explain-sentence";
  throw new RangeError("Paragraph explanation is unsupported.");
}

export function modelAnalysisResultSchemaFor(
  resultType: ModelResultType,
): z.ZodType<ModelAnalysisResult> {
  return MODEL_ANALYSIS_RESULT_SCHEMAS[resultType];
}

export function modelAnalysisFieldSchemaFor(
  resultType: ModelResultType,
  field: string,
): z.ZodType | undefined {
  return MODEL_ANALYSIS_FIELD_SCHEMAS[resultType].get(field);
}

import {
  MAX_COLLOCATIONS,
  MAX_COMMON_PHRASES,
  MAX_CONFUSABLE_WORDS,
  MAX_CONTEXT_LENGTH,
  MAX_CORE_MEANINGS,
  MAX_DICTIONARY_MEANING_GROUPS,
  MAX_MODEL_TEXT_LENGTH,
  MAX_RELATED_TERMS,
  MAX_SYNONYM_COMPARISONS,
  MAX_USAGE_NOTES,
  collocationSchema,
  commonPhraseSchema,
  confusableWordSchema,
  contextualSenseSchema,
  coreMeaningSchema,
  dictionaryMeaningGroupSchema,
  partOfSpeechSchema,
  relatedTermSchema,
  synonymComparisonSchema,
  usageNoteSchema,
  type AnalysisResult,
  type AnalyzeRequest,
  type Collocation,
  type CommonPhrase,
  type ConfusableWord,
  type ContextualSense,
  type CoreMeaning,
  type DictionaryMeaningGroup,
  type PartOfSpeech,
  type RelatedTerm,
  type SynonymComparison,
  type UsageNote,
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
const pronunciationObjectSchema = z.strictObject({
  uk: z.string().trim().min(1).max(120).nullable(),
  us: z.string().trim().min(1).max(120).nullable(),
});
const nullablePronunciationSchema = pronunciationObjectSchema.nullable();
const keyExpressionSchema = z.strictObject({
  meaningZh: chineseTextSchema.max(500),
  text: englishTextSchema.max(300),
});

type RawOwnKeyShape =
  | { item: RawOwnKeyShape; kind: "array" }
  | { kind: "leaf" }
  | { kind: "nullable"; value: RawOwnKeyShape }
  | RawOwnKeyObjectShape;

interface RawOwnKeyObjectShape {
  fields: ReadonlyMap<string, RawOwnKeyShape>;
  kind: "object";
}

const RAW_OWN_KEY_LEAF = { kind: "leaf" } as const satisfies RawOwnKeyShape;

function rawOwnKeyArray(item: RawOwnKeyShape): RawOwnKeyShape {
  return { item, kind: "array" };
}

function rawOwnKeyNullable(value: RawOwnKeyShape): RawOwnKeyShape {
  return { kind: "nullable", value };
}

function rawOwnKeyObjectFor(
  schema: { readonly shape: object },
  nestedFields: ReadonlyMap<string, RawOwnKeyShape> = new Map(),
): RawOwnKeyObjectShape {
  return {
    fields: new Map(
      Object.keys(schema.shape).map((field) => [
        field,
        nestedFields.get(field) ?? RAW_OWN_KEY_LEAF,
      ]),
    ),
    kind: "object",
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRawOwnKeys(
  value: unknown,
  shape: RawOwnKeyShape,
  context: z.RefinementCtx,
  path: (number | string)[] = [],
): void {
  if (shape.kind === "leaf") return;
  if (shape.kind === "nullable") {
    if (value !== null) validateRawOwnKeys(value, shape.value, context, path);
    return;
  }
  if (shape.kind === "array") {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        validateRawOwnKeys(item, shape.item, context, [...path, index]),
      );
    }
    return;
  }
  if (!isObjectRecord(value)) return;

  for (const field of Object.keys(value)) {
    const fieldShape = shape.fields.get(field);
    if (fieldShape === undefined) {
      context.addIssue({
        code: "custom",
        message: "Unrecognized model field.",
        path: [...path, field],
      });
      continue;
    }
    validateRawOwnKeys(value[field], fieldShape, context, [...path, field]);
  }
}

function withRawOwnKeyValidation<Output>(
  schema: z.ZodType<Output>,
  shape: RawOwnKeyShape,
): z.ZodType<Output> {
  return z.preprocess((value, context) => {
    validateRawOwnKeys(value, shape, context);
    return value;
  }, schema);
}

function guardedFieldSchemasFor(
  schema: { readonly shape: Readonly<Record<string, z.ZodType>> },
  shape: RawOwnKeyObjectShape,
): ReadonlyMap<string, z.ZodType> {
  const fields = new Map<string, z.ZodType>();
  for (const [field, fieldSchema] of Object.entries(schema.shape)) {
    fields.set(
      field,
      withRawOwnKeyValidation(fieldSchema, shape.fields.get(field) ?? RAW_OWN_KEY_LEAF),
    );
  }
  return fields;
}

export interface ModelLexicalTranslation {
  contextualMeaningZh: string;
  partOfSpeech: PartOfSpeech;
  pronunciation: { uk: string | null; us: string | null } | null;
  collocations: Collocation[];
  contextExampleTranslationZh: string | null;
  similarTerms: RelatedTerm[];
}

export interface ModelWordTranslation {
  pronunciation: { uk: string | null; us: string | null } | null;
  contextualSense: ContextualSense;
  dictionaryForm: string;
  commonMeanings: DictionaryMeaningGroup[];
  commonPhrases: CommonPhrase[];
  confusableWords: ConfusableWord[];
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

export interface ModelWordExplanation {
  contextualAnalysisZh: string;
  wordForm: {
    baseForm: string;
    formTypeZh: string;
    sentenceRoleZh: string | null;
  };
  wordFormationZh: string | null;
  usageNotes: UsageNote[];
  synonyms: SynonymComparison[];
}

export interface ModelSentenceExplanation {
  mainStructure: string;
  keyExpressions: { meaningZh: string; text: string }[];
  translationZh: string;
  contextRole: string;
}

export type ModelAnalysisResult =
  | ModelWordTranslation
  | ModelWordExplanation
  | ModelLexicalTranslation
  | ModelPassageTranslation
  | ModelLexicalExplanation
  | ModelSentenceExplanation;

export type ModelResultType = AnalysisResult["type"];

const modelLexicalTranslationObjectSchema = z.strictObject({
  contextualMeaningZh: chineseTextSchema,
  partOfSpeech: partOfSpeechSchema,
  pronunciation: nullablePronunciationSchema,
  collocations: z.array(collocationSchema).max(MAX_COLLOCATIONS),
  contextExampleTranslationZh: chineseTextSchema.nullable(),
  similarTerms: z.array(relatedTermSchema).max(MAX_RELATED_TERMS),
});

const modelWordTranslationObjectSchema = z.strictObject({
  pronunciation: nullablePronunciationSchema,
  contextualSense: contextualSenseSchema,
  dictionaryForm: englishTextSchema.max(120),
  commonMeanings: z.array(dictionaryMeaningGroupSchema).min(1).max(MAX_DICTIONARY_MEANING_GROUPS),
  commonPhrases: z.array(commonPhraseSchema).max(MAX_COMMON_PHRASES),
  confusableWords: z.array(confusableWordSchema).max(MAX_CONFUSABLE_WORDS),
});

const modelPassageTranslationObjectSchema = z.strictObject({
  translationZh: chineseTextSchema,
});

const modelLexicalExplanationObjectSchema = z.strictObject({
  contextualMeaningZh: chineseTextSchema,
  baseForm: englishTextSchema.max(120).nullable(),
  wordFormation: z.string().trim().min(1).max(300).nullable(),
  coreMeanings: z.array(coreMeaningSchema).min(1).max(MAX_CORE_MEANINGS),
  collocations: z.array(collocationSchema).max(MAX_COLLOCATIONS),
  synonyms: z.array(relatedTermSchema).max(MAX_RELATED_TERMS),
});

const modelWordFormSchema = z.strictObject({
  baseForm: englishTextSchema.max(120),
  formTypeZh: chineseTextSchema.max(300),
  sentenceRoleZh: chineseTextSchema.max(500).nullable(),
});

const modelWordExplanationObjectSchema = z.strictObject({
  contextualAnalysisZh: chineseTextSchema,
  wordForm: modelWordFormSchema,
  wordFormationZh: chineseTextSchema.max(500).nullable(),
  usageNotes: z.array(usageNoteSchema).max(MAX_USAGE_NOTES),
  synonyms: z.array(synonymComparisonSchema).max(MAX_SYNONYM_COMPARISONS),
});

const modelSentenceExplanationObjectSchema = z.strictObject({
  mainStructure: z.string().trim().min(1).max(MAX_MODEL_TEXT_LENGTH),
  keyExpressions: z.array(keyExpressionSchema).min(1).max(6),
  translationZh: chineseTextSchema,
  contextRole: chineseTextSchema,
});

const collocationOwnKeys = rawOwnKeyObjectFor(collocationSchema);
const coreMeaningOwnKeys = rawOwnKeyObjectFor(coreMeaningSchema);
const relatedTermOwnKeys = rawOwnKeyObjectFor(relatedTermSchema);
const contextualSenseOwnKeys = rawOwnKeyObjectFor(contextualSenseSchema);
const dictionaryMeaningGroupOwnKeys = rawOwnKeyObjectFor(dictionaryMeaningGroupSchema);
const commonPhraseOwnKeys = rawOwnKeyObjectFor(commonPhraseSchema);
const confusableWordOwnKeys = rawOwnKeyObjectFor(confusableWordSchema);
const usageNoteOwnKeys = rawOwnKeyObjectFor(usageNoteSchema);
const synonymComparisonOwnKeys = rawOwnKeyObjectFor(synonymComparisonSchema);
const pronunciationOwnKeys = rawOwnKeyNullable(rawOwnKeyObjectFor(pronunciationObjectSchema));
const keyExpressionOwnKeys = rawOwnKeyObjectFor(keyExpressionSchema);

const modelLexicalTranslationOwnKeys = rawOwnKeyObjectFor(
  modelLexicalTranslationObjectSchema,
  new Map<string, RawOwnKeyShape>([
    ["collocations", rawOwnKeyArray(collocationOwnKeys)],
    ["pronunciation", pronunciationOwnKeys],
    ["similarTerms", rawOwnKeyArray(relatedTermOwnKeys)],
  ]),
);
const modelWordTranslationOwnKeys = rawOwnKeyObjectFor(
  modelWordTranslationObjectSchema,
  new Map<string, RawOwnKeyShape>([
    ["pronunciation", pronunciationOwnKeys],
    ["contextualSense", contextualSenseOwnKeys],
    ["commonMeanings", rawOwnKeyArray(dictionaryMeaningGroupOwnKeys)],
    ["commonPhrases", rawOwnKeyArray(commonPhraseOwnKeys)],
    ["confusableWords", rawOwnKeyArray(confusableWordOwnKeys)],
  ]),
);
const modelPassageTranslationOwnKeys = rawOwnKeyObjectFor(modelPassageTranslationObjectSchema);
const modelLexicalExplanationOwnKeys = rawOwnKeyObjectFor(
  modelLexicalExplanationObjectSchema,
  new Map<string, RawOwnKeyShape>([
    ["collocations", rawOwnKeyArray(collocationOwnKeys)],
    ["coreMeanings", rawOwnKeyArray(coreMeaningOwnKeys)],
    ["synonyms", rawOwnKeyArray(relatedTermOwnKeys)],
  ]),
);
const modelWordExplanationOwnKeys = rawOwnKeyObjectFor(
  modelWordExplanationObjectSchema,
  new Map<string, RawOwnKeyShape>([
    ["wordForm", rawOwnKeyObjectFor(modelWordFormSchema)],
    ["usageNotes", rawOwnKeyArray(usageNoteOwnKeys)],
    ["synonyms", rawOwnKeyArray(synonymComparisonOwnKeys)],
  ]),
);
const modelSentenceExplanationOwnKeys = rawOwnKeyObjectFor(
  modelSentenceExplanationObjectSchema,
  new Map<string, RawOwnKeyShape>([["keyExpressions", rawOwnKeyArray(keyExpressionOwnKeys)]]),
);

export const modelLexicalTranslationSchema = withRawOwnKeyValidation(
  modelLexicalTranslationObjectSchema,
  modelLexicalTranslationOwnKeys,
) satisfies z.ZodType<ModelLexicalTranslation>;

export const modelWordTranslationSchema = withRawOwnKeyValidation(
  modelWordTranslationObjectSchema,
  modelWordTranslationOwnKeys,
) satisfies z.ZodType<ModelWordTranslation>;

export const modelPassageTranslationSchema = withRawOwnKeyValidation(
  modelPassageTranslationObjectSchema,
  modelPassageTranslationOwnKeys,
) satisfies z.ZodType<ModelPassageTranslation>;

export const modelLexicalExplanationSchema = withRawOwnKeyValidation(
  modelLexicalExplanationObjectSchema,
  modelLexicalExplanationOwnKeys,
) satisfies z.ZodType<ModelLexicalExplanation>;

export const modelWordExplanationSchema = withRawOwnKeyValidation(
  modelWordExplanationObjectSchema,
  modelWordExplanationOwnKeys,
) satisfies z.ZodType<ModelWordExplanation>;

export const modelSentenceExplanationSchema = withRawOwnKeyValidation(
  modelSentenceExplanationObjectSchema,
  modelSentenceExplanationOwnKeys,
) satisfies z.ZodType<ModelSentenceExplanation>;

const MODEL_ANALYSIS_RESULT_SCHEMAS = {
  "explain-word": modelWordExplanationSchema,
  "explain-lexical": modelLexicalExplanationSchema,
  "explain-sentence": modelSentenceExplanationSchema,
  "translate-lexical": modelLexicalTranslationSchema,
  "translate-passage": modelPassageTranslationSchema,
  "translate-word": modelWordTranslationSchema,
} satisfies Record<ModelResultType, z.ZodType<ModelAnalysisResult>>;

const MODEL_ANALYSIS_FIELD_SCHEMAS: Record<ModelResultType, ReadonlyMap<string, z.ZodType>> = {
  "explain-word": guardedFieldSchemasFor(
    modelWordExplanationObjectSchema,
    modelWordExplanationOwnKeys,
  ),
  "explain-lexical": guardedFieldSchemasFor(
    modelLexicalExplanationObjectSchema,
    modelLexicalExplanationOwnKeys,
  ),
  "explain-sentence": guardedFieldSchemasFor(
    modelSentenceExplanationObjectSchema,
    modelSentenceExplanationOwnKeys,
  ),
  "translate-lexical": guardedFieldSchemasFor(
    modelLexicalTranslationObjectSchema,
    modelLexicalTranslationOwnKeys,
  ),
  "translate-passage": guardedFieldSchemasFor(
    modelPassageTranslationObjectSchema,
    modelPassageTranslationOwnKeys,
  ),
  "translate-word": guardedFieldSchemasFor(
    modelWordTranslationObjectSchema,
    modelWordTranslationOwnKeys,
  ),
};

const MODEL_ARRAY_ITEM_SCHEMAS = {
  "explain-word": new Map<string, z.ZodType>([
    ["usageNotes", usageNoteSchema],
    ["synonyms", synonymComparisonSchema],
  ]),
  "explain-lexical": new Map<string, z.ZodType>([
    ["collocations", collocationSchema],
    ["coreMeanings", coreMeaningSchema],
    ["synonyms", relatedTermSchema],
  ]),
  "explain-sentence": new Map<string, z.ZodType>(),
  "translate-lexical": new Map<string, z.ZodType>([
    ["collocations", collocationSchema],
    ["similarTerms", relatedTermSchema],
  ]),
  "translate-passage": new Map<string, z.ZodType>(),
  "translate-word": new Map<string, z.ZodType>([
    ["commonMeanings", dictionaryMeaningGroupSchema],
    ["commonPhrases", commonPhraseSchema],
    ["confusableWords", confusableWordSchema],
  ]),
} satisfies Record<ModelResultType, ReadonlyMap<string, z.ZodType>>;

export function resultTypeFor(
  request: Pick<AnalyzeRequest, "action" | "selectionKind">,
): ModelResultType {
  if (request.selectionKind === "word") {
    return request.action === "translate" ? "translate-word" : "explain-word";
  }
  if (request.selectionKind === "phrase") {
    return request.action === "translate" ? "translate-lexical" : "explain-lexical";
  }
  if (request.action === "translate") return "translate-passage";
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

export function modelAnalysisArrayItemSchemaFor(
  resultType: ModelResultType,
  field: string,
): z.ZodType | undefined {
  return MODEL_ARRAY_ITEM_SCHEMAS[resultType].get(field);
}

import {
  collocationSchema,
  commonPhraseSchema,
  confusableWordSchema,
  contextualSenseSchema,
  coreMeaningSchema,
  MAX_MODEL_TEXT_LENGTH,
  partOfSpeechSchema,
  relatedTermSchema,
  synonymComparisonSchema,
  usageNoteSchema,
  type AnalysisRequest,
  type AnalysisResult,
} from "@huayi/store-domain";
import { z } from "zod/v3";

import { MODEL_JSON_SCHEMAS } from "./model-json-schemas.js";

export const STORE_ANALYSIS_SCHEMA_VERSION = 1;

const chineseText = z.string().trim().min(1).max(MAX_MODEL_TEXT_LENGTH);
function englishText(maximum: number): z.ZodEffects<z.ZodEffects<z.ZodString>> {
  return z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => /[A-Za-z]/u.test(value))
    .refine((value) => !/[\u3400-\u9fff]/u.test(value));
}
const nullablePronunciation = z
  .strictObject({
    uk: z.string().trim().min(1).max(120).nullable(),
    us: z.string().trim().min(1).max(120).nullable(),
  })
  .nullable();

const modelSchemas = {
  "explain-lexical": z.strictObject({
    baseForm: englishText(120).nullable(),
    collocations: z.array(collocationSchema).max(3),
    contextualMeaningZh: chineseText,
    coreMeanings: z.array(coreMeaningSchema).min(1).max(3),
    synonyms: z.array(relatedTermSchema).max(3),
    wordFormation: z.string().trim().min(1).max(300).nullable(),
  }),
  "explain-sentence": z.strictObject({
    contextRole: chineseText,
    keyExpressions: z
      .array(
        z.strictObject({
          meaningZh: chineseText.max(500),
          text: englishText(300),
        }),
      )
      .min(1)
      .max(6),
    mainStructure: chineseText,
    translationZh: chineseText,
  }),
  "explain-word": z.strictObject({
    contextualAnalysisZh: chineseText,
    synonyms: z.array(synonymComparisonSchema).max(3),
    usageNotes: z.array(usageNoteSchema).max(3),
    wordForm: z.strictObject({
      baseForm: englishText(120),
      formTypeZh: chineseText.max(300),
      sentenceRoleZh: chineseText.max(500).nullable(),
    }),
    wordFormationZh: chineseText.max(500).nullable(),
  }),
  "translate-lexical": z.strictObject({
    collocations: z.array(collocationSchema).max(3),
    contextExampleTranslationZh: chineseText.nullable(),
    contextualMeaningZh: chineseText,
    partOfSpeech: partOfSpeechSchema,
    pronunciation: nullablePronunciation,
    similarTerms: z.array(relatedTermSchema).max(3),
  }),
  "translate-passage": z.strictObject({ translationZh: chineseText }),
  "translate-word": z.strictObject({
    commonMeanings: z
      .array(
        z.strictObject({
          meaningsZh: z.array(chineseText.max(300)).min(1).max(3),
          partOfSpeech: partOfSpeechSchema,
        }),
      )
      .min(1)
      .max(4),
    commonPhrases: z.array(commonPhraseSchema).max(4),
    confusableWords: z.array(confusableWordSchema).max(4),
    contextualSense: contextualSenseSchema,
    dictionaryForm: englishText(120),
    pronunciation: nullablePronunciation,
  }),
} as const;

const modelFieldSchemas: Readonly<
  Record<keyof typeof modelSchemas, ReadonlyMap<string, z.ZodType<unknown>>>
> = {
  "explain-lexical": new Map(Object.entries(modelSchemas["explain-lexical"].shape)),
  "explain-sentence": new Map(Object.entries(modelSchemas["explain-sentence"].shape)),
  "explain-word": new Map(Object.entries(modelSchemas["explain-word"].shape)),
  "translate-lexical": new Map(Object.entries(modelSchemas["translate-lexical"].shape)),
  "translate-passage": new Map(Object.entries(modelSchemas["translate-passage"].shape)),
  "translate-word": new Map(Object.entries(modelSchemas["translate-word"].shape)),
};

const modelArrayItemSchemas: Readonly<
  Record<keyof typeof modelSchemas, ReadonlyMap<string, z.ZodType<unknown>>>
> = {
  "explain-lexical": new Map<string, z.ZodType<unknown>>([
    ["collocations", modelSchemas["explain-lexical"].shape.collocations.element],
    ["coreMeanings", modelSchemas["explain-lexical"].shape.coreMeanings.element],
    ["synonyms", modelSchemas["explain-lexical"].shape.synonyms.element],
  ]),
  "explain-sentence": new Map<string, z.ZodType<unknown>>([
    ["keyExpressions", modelSchemas["explain-sentence"].shape.keyExpressions.element],
  ]),
  "explain-word": new Map<string, z.ZodType<unknown>>([
    ["synonyms", modelSchemas["explain-word"].shape.synonyms.element],
    ["usageNotes", modelSchemas["explain-word"].shape.usageNotes.element],
  ]),
  "translate-lexical": new Map<string, z.ZodType<unknown>>([
    ["collocations", modelSchemas["translate-lexical"].shape.collocations.element],
    ["similarTerms", modelSchemas["translate-lexical"].shape.similarTerms.element],
  ]),
  "translate-passage": new Map<string, z.ZodType<unknown>>(),
  "translate-word": new Map<string, z.ZodType<unknown>>([
    ["commonMeanings", modelSchemas["translate-word"].shape.commonMeanings.element],
    ["commonPhrases", modelSchemas["translate-word"].shape.commonPhrases.element],
    ["confusableWords", modelSchemas["translate-word"].shape.confusableWords.element],
  ]),
};

export type ModelResultType = keyof typeof modelSchemas;
export type ModelResult = z.infer<(typeof modelSchemas)[ModelResultType]>;

export function resultTypeFor(request: AnalysisRequest): ModelResultType {
  if (request.selectionKind === "word") {
    return request.action === "translate" ? "translate-word" : "explain-word";
  }
  if (request.selectionKind === "phrase") {
    return request.action === "translate" ? "translate-lexical" : "explain-lexical";
  }
  return request.action === "translate" ? "translate-passage" : "explain-sentence";
}

export function parseModelResult(type: ModelResultType, value: unknown): ModelResult {
  return modelSchemas[type].parse(value) as ModelResult;
}

export function parseModelField(
  type: ModelResultType,
  field: string,
  value: unknown,
): unknown | undefined {
  const schema = modelFieldSchemas[type].get(field);
  return schema?.parse(value);
}

export function parseModelArrayItem(
  type: ModelResultType,
  field: string,
  value: unknown,
): unknown | undefined {
  const schema = modelArrayItemSchemas[type].get(field);
  return schema?.parse(value);
}

function mergeDictionaryMeaningGroups(
  groups: z.infer<(typeof modelSchemas)["translate-word"]>["commonMeanings"],
) {
  const merged = new Map<
    z.infer<typeof partOfSpeechSchema>,
    z.infer<(typeof modelSchemas)["translate-word"]>["commonMeanings"][number]
  >();
  for (const group of groups) {
    const previous = merged.get(group.partOfSpeech);
    merged.set(group.partOfSpeech, {
      meaningsZh: [...new Set([...(previous?.meaningsZh ?? []), ...group.meaningsZh])].slice(0, 3),
      partOfSpeech: group.partOfSpeech,
    });
  }
  return [...merged.values()];
}

function normalizedEnglish(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function deduplicateByText<Item extends { text: string }>(
  items: readonly Item[],
  excluded: ReadonlySet<string> = new Set<string>(),
): Item[] {
  const result: Item[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = normalizedEnglish(item.text);
    if (seen.has(normalized) || excluded.has(normalized)) continue;
    seen.add(normalized);
    result.push(item);
  }
  return result;
}

function pronunciation(
  value: { uk: string | null; us: string | null } | null,
): { uk?: string; us?: string } | undefined {
  if (value === null) return undefined;
  const result = {
    ...(value.uk === null ? {} : { uk: value.uk }),
    ...(value.us === null ? {} : { us: value.us }),
  };
  return Object.keys(result).length === 0 ? undefined : result;
}

export function assemblePublicResult(
  request: AnalysisRequest,
  type: ModelResultType,
  value: ModelResult,
): AnalysisResult {
  const trusted = {
    requestId: request.requestId,
    selectionKind: request.selectionKind,
    sourceText: request.selection,
    type,
  };
  switch (type) {
    case "translate-passage":
      return { ...trusted, ...(value as { translationZh: string }) } as AnalysisResult;
    case "explain-sentence":
      return { ...trusted, ...(value as object) } as AnalysisResult;
    case "translate-lexical": {
      const content = value as z.infer<(typeof modelSchemas)["translate-lexical"]>;
      const normalizedPronunciation = pronunciation(content.pronunciation);
      if (content.contextExampleTranslationZh !== null && request.sentenceContext === null) {
        throw new Error("invalid-context-example");
      }
      return {
        ...trusted,
        collocations: content.collocations,
        ...(content.contextExampleTranslationZh === null
          ? {}
          : {
              contextExample: {
                english: request.sentenceContext as string,
                translationZh: content.contextExampleTranslationZh,
              },
            }),
        contextualMeaningZh: content.contextualMeaningZh,
        partOfSpeech: content.partOfSpeech,
        ...(normalizedPronunciation === undefined
          ? {}
          : { pronunciation: normalizedPronunciation }),
        similarTerms: content.similarTerms,
      } as AnalysisResult;
    }
    case "translate-word": {
      const content = value as z.infer<(typeof modelSchemas)["translate-word"]>;
      const normalizedPronunciation = pronunciation(content.pronunciation);
      const excluded = new Set([
        normalizedEnglish(request.selection),
        normalizedEnglish(content.dictionaryForm),
      ]);
      return {
        ...trusted,
        commonMeanings: mergeDictionaryMeaningGroups(content.commonMeanings),
        commonPhrases: deduplicateByText(content.commonPhrases),
        confusableWords: deduplicateByText(content.confusableWords, excluded),
        contextualSense: content.contextualSense,
        dictionaryForm: content.dictionaryForm,
        ...(normalizedPronunciation === undefined
          ? {}
          : { pronunciation: normalizedPronunciation }),
      } as AnalysisResult;
    }
    case "explain-lexical": {
      const content = value as z.infer<(typeof modelSchemas)["explain-lexical"]>;
      return {
        ...trusted,
        ...(content.baseForm === null ? {} : { baseForm: content.baseForm }),
        collocations: content.collocations,
        contextualMeaningZh: content.contextualMeaningZh,
        coreMeanings: content.coreMeanings,
        synonyms: content.synonyms,
        ...(content.wordFormation === null ? {} : { wordFormation: content.wordFormation }),
      } as AnalysisResult;
    }
    case "explain-word": {
      const content = value as z.infer<(typeof modelSchemas)["explain-word"]>;
      return {
        ...trusted,
        contextualAnalysisZh: content.contextualAnalysisZh,
        synonyms: content.synonyms,
        usageNotes: content.usageNotes,
        wordForm: {
          baseForm: content.wordForm.baseForm,
          formTypeZh: content.wordForm.formTypeZh,
          ...(content.wordForm.sentenceRoleZh === null
            ? {}
            : { sentenceRoleZh: content.wordForm.sentenceRoleZh }),
        },
        ...(content.wordFormationZh === null ? {} : { wordFormationZh: content.wordFormationZh }),
      } as AnalysisResult;
    }
  }
}

export function jsonSchemaFor(type: ModelResultType): Record<string, unknown> {
  return MODEL_JSON_SCHEMAS[type];
}

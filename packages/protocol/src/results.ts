import { z } from "zod";

import {
  MAX_COLLOCATIONS,
  MAX_COMMON_PHRASES,
  MAX_CONFUSABLE_WORDS,
  MAX_CONTEXT_LENGTH,
  MAX_CORE_MEANINGS,
  MAX_DICTIONARY_MEANING_GROUPS,
  MAX_MEANINGS_PER_GROUP,
  MAX_MODEL_TEXT_LENGTH,
  MAX_RELATED_TERMS,
  MAX_SELECTION_LENGTH,
  MAX_SYNONYM_COMPARISONS,
  MAX_USAGE_NOTES,
} from "./limits.js";

const chineseTextSchema = z.string().trim().min(1).max(MAX_MODEL_TEXT_LENGTH);
const wordChineseTextSchema = chineseTextSchema.refine(
  (value) => /[\u3400-\u9fff]/.test(value),
  "Expected Chinese text.",
);
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

const lexicalKindSchema = z.literal("phrase");
const passageKindSchema = z.enum(["sentence", "paragraph"]);

export const pronunciationSchema = z
  .strictObject({
    uk: z.string().trim().min(1).max(120).optional(),
    us: z.string().trim().min(1).max(120).optional(),
  })
  .refine((value) => value.uk !== undefined || value.us !== undefined, {
    message: "At least one pronunciation is required.",
  });
export type Pronunciation = z.infer<typeof pronunciationSchema>;

export const contextExampleSchema = z.strictObject({
  english: englishTextSchema,
  translationZh: chineseTextSchema,
});
export type ContextExample = z.infer<typeof contextExampleSchema>;

export const contextualSenseSchema = z.strictObject({
  meaningZh: wordChineseTextSchema.max(300),
  partOfSpeech: partOfSpeechSchema,
});
export type ContextualSense = z.infer<typeof contextualSenseSchema>;

export const dictionaryMeaningGroupSchema = z.strictObject({
  meaningsZh: z.array(wordChineseTextSchema.max(300)).min(1).max(MAX_MEANINGS_PER_GROUP),
  partOfSpeech: partOfSpeechSchema,
});
export type DictionaryMeaningGroup = z.infer<typeof dictionaryMeaningGroupSchema>;

export const commonPhraseSchema = z.strictObject({
  meaningZh: wordChineseTextSchema.max(300),
  text: englishTextSchema.max(200),
});
export type CommonPhrase = z.infer<typeof commonPhraseSchema>;

export const confusableWordSchema = z.strictObject({
  distinctionZh: wordChineseTextSchema.max(500),
  meaningZh: wordChineseTextSchema.max(200),
  partOfSpeech: partOfSpeechSchema,
  text: englishTextSchema.max(120),
});
export type ConfusableWord = z.infer<typeof confusableWordSchema>;

function normalizedEnglish(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: (number | string)[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const normalized = normalizedEnglish(value);
    if (seen.has(normalized)) {
      context.addIssue({ code: "custom", message: "Duplicate item.", path: [...path, index] });
    }
    seen.add(normalized);
  });
}

export const wordTranslationResultSchema = z
  .strictObject({
    commonMeanings: z.array(dictionaryMeaningGroupSchema).min(1).max(MAX_DICTIONARY_MEANING_GROUPS),
    commonPhrases: z.array(commonPhraseSchema).max(MAX_COMMON_PHRASES),
    confusableWords: z.array(confusableWordSchema).max(MAX_CONFUSABLE_WORDS),
    contextualSense: contextualSenseSchema,
    dictionaryForm: englishTextSchema.max(120),
    pronunciation: pronunciationSchema.optional(),
    selectionKind: z.literal("word"),
    sourceText: sourceTextSchema,
    type: z.literal("translate-word"),
  })
  .superRefine((value, context) => {
    addDuplicateIssues(
      value.commonMeanings.map((group) => group.partOfSpeech),
      context,
      ["commonMeanings"],
    );
    value.commonMeanings.forEach((group, index) =>
      addDuplicateIssues(group.meaningsZh, context, ["commonMeanings", index, "meaningsZh"]),
    );
    addDuplicateIssues(
      value.commonPhrases.map((phrase) => phrase.text),
      context,
      ["commonPhrases"],
    );
    addDuplicateIssues(
      value.confusableWords.map((word) => word.text),
      context,
      ["confusableWords"],
    );
    const forbidden = new Set([
      normalizedEnglish(value.sourceText),
      normalizedEnglish(value.dictionaryForm),
    ]);
    value.confusableWords.forEach((word, index) => {
      if (forbidden.has(normalizedEnglish(word.text))) {
        context.addIssue({
          code: "custom",
          message: "A confusable word must differ from the source word.",
          path: ["confusableWords", index, "text"],
        });
      }
    });
  });
export type WordTranslationResult = z.infer<typeof wordTranslationResultSchema>;

export const lexicalTranslationResultSchema = z.strictObject({
  collocations: z.array(collocationSchema).max(MAX_COLLOCATIONS),
  contextExample: contextExampleSchema.optional(),
  contextualMeaningZh: chineseTextSchema,
  partOfSpeech: partOfSpeechSchema,
  pronunciation: pronunciationSchema.optional(),
  selectionKind: lexicalKindSchema,
  similarTerms: z.array(relatedTermSchema).max(MAX_RELATED_TERMS),
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

export const coreMeaningSchema = z.strictObject({
  meaningZh: chineseTextSchema.max(300),
  partOfSpeech: partOfSpeechSchema,
});
export type CoreMeaning = z.infer<typeof coreMeaningSchema>;

export const lexicalExplanationResultSchema = z.strictObject({
  baseForm: englishTextSchema.max(120).optional(),
  collocations: z.array(collocationSchema).max(MAX_COLLOCATIONS),
  contextualMeaningZh: chineseTextSchema,
  coreMeanings: z.array(coreMeaningSchema).min(1).max(MAX_CORE_MEANINGS),
  selectionKind: lexicalKindSchema,
  sourceText: sourceTextSchema,
  synonyms: z.array(relatedTermSchema).max(MAX_RELATED_TERMS),
  type: z.literal("explain-lexical"),
  wordFormation: z.string().trim().min(1).max(300).optional(),
});
export type LexicalExplanationResult = z.infer<typeof lexicalExplanationResultSchema>;

export const wordFormAnalysisSchema = z.strictObject({
  baseForm: englishTextSchema.max(120),
  formTypeZh: wordChineseTextSchema.max(300),
  sentenceRoleZh: wordChineseTextSchema.max(500).optional(),
});
export type WordFormAnalysis = z.infer<typeof wordFormAnalysisSchema>;

export const usageNoteSchema = z.strictObject({
  descriptionZh: wordChineseTextSchema.max(500),
  titleZh: wordChineseTextSchema.max(120),
});
export type UsageNote = z.infer<typeof usageNoteSchema>;

export const synonymComparisonSchema = z.strictObject({
  distinctionZh: wordChineseTextSchema.max(500),
  meaningZh: wordChineseTextSchema.max(200),
  partOfSpeech: partOfSpeechSchema,
  text: englishTextSchema.max(120),
});
export type SynonymComparison = z.infer<typeof synonymComparisonSchema>;

export const wordExplanationResultSchema = z
  .strictObject({
    contextualAnalysisZh: wordChineseTextSchema,
    selectionKind: z.literal("word"),
    sourceText: sourceTextSchema,
    synonyms: z.array(synonymComparisonSchema).max(MAX_SYNONYM_COMPARISONS),
    type: z.literal("explain-word"),
    usageNotes: z.array(usageNoteSchema).max(MAX_USAGE_NOTES),
    wordForm: wordFormAnalysisSchema,
    wordFormationZh: wordChineseTextSchema.max(500).optional(),
  })
  .superRefine((value, context) => {
    addDuplicateIssues(
      value.synonyms.map((synonym) => synonym.text),
      context,
      ["synonyms"],
    );
    addDuplicateIssues(
      value.usageNotes.map((note) => note.titleZh),
      context,
      ["usageNotes"],
    );
    const forbidden = new Set([
      normalizedEnglish(value.sourceText),
      normalizedEnglish(value.wordForm.baseForm),
    ]);
    value.synonyms.forEach((synonym, index) => {
      if (forbidden.has(normalizedEnglish(synonym.text))) {
        context.addIssue({
          code: "custom",
          message: "A synonym must differ from the source word.",
          path: ["synonyms", index, "text"],
        });
      }
    });
  });
export type WordExplanationResult = z.infer<typeof wordExplanationResultSchema>;

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

export const analysisResultSchema = z.union([
  wordTranslationResultSchema,
  wordExplanationResultSchema,
  lexicalTranslationResultSchema,
  passageTranslationResultSchema,
  lexicalExplanationResultSchema,
  sentenceExplanationResultSchema,
]);
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

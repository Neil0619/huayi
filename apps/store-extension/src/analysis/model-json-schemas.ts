import { MAX_MODEL_TEXT_LENGTH } from "@huayi/store-domain";

type JsonSchema = Readonly<Record<string, unknown>>;

const partOfSpeech = {
  enum: [
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
  ],
  type: "string",
} as const;

function text(maxLength: number): JsonSchema {
  return { maxLength, minLength: 1, type: "string" };
}

function englishText(maxLength: number): JsonSchema {
  return {
    ...text(maxLength),
    pattern: "^[^\\u3400-\\u9fff]*[A-Za-z][^\\u3400-\\u9fff]*$",
  };
}

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: "null" }] };
}

function array(items: JsonSchema, maxItems: number, minItems = 0): JsonSchema {
  return { items, maxItems, minItems, type: "array" };
}

function described(schema: JsonSchema, description: string): JsonSchema {
  return { ...schema, description };
}

function strictObject(properties: Readonly<Record<string, JsonSchema>>): JsonSchema {
  return {
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
    type: "object",
  };
}

function root(properties: Readonly<Record<string, JsonSchema>>): JsonSchema {
  return { $schema: "http://json-schema.org/draft-07/schema#", ...strictObject(properties) };
}

const collocation = strictObject({ meaningZh: text(300), text: englishText(200) });
const relatedTerm = strictObject({
  meaningZh: text(200),
  partOfSpeech,
  text: englishText(120),
});
const coreMeaning = strictObject({ meaningZh: text(300), partOfSpeech });
const commonPhrase = strictObject({ meaningZh: text(300), text: englishText(200) });
const confusableWord = strictObject({
  distinctionZh: text(500),
  meaningZh: text(200),
  partOfSpeech,
  text: englishText(120),
});
const contextualSense = strictObject({ meaningZh: text(300), partOfSpeech });
const synonymComparison = strictObject({
  distinctionZh: text(500),
  meaningZh: text(200),
  partOfSpeech,
  text: englishText(120),
});
const usageNote = strictObject({ descriptionZh: text(500), titleZh: text(120) });
const pronunciation = nullable(
  strictObject({
    uk: nullable(text(120)),
    us: nullable(text(120)),
  }),
);

export const MODEL_JSON_SCHEMAS = {
  "explain-lexical": root({
    contextualMeaningZh: text(MAX_MODEL_TEXT_LENGTH),
    baseForm: nullable(englishText(120)),
    wordFormation: nullable(text(300)),
    coreMeanings: array(coreMeaning, 3, 1),
    collocations: array(collocation, 3),
    synonyms: array(relatedTerm, 3),
  }),
  "explain-sentence": root({
    mainStructure: text(MAX_MODEL_TEXT_LENGTH),
    keyExpressions: array(strictObject({ meaningZh: text(500), text: englishText(300) }), 6, 1),
    translationZh: text(MAX_MODEL_TEXT_LENGTH),
    contextRole: text(MAX_MODEL_TEXT_LENGTH),
  }),
  "explain-word": root({
    contextualAnalysisZh: text(MAX_MODEL_TEXT_LENGTH),
    wordForm: strictObject({
      baseForm: englishText(120),
      formTypeZh: text(300),
      sentenceRoleZh: nullable(text(500)),
    }),
    wordFormationZh: nullable(text(500)),
    usageNotes: array(usageNote, 3),
    synonyms: array(synonymComparison, 3),
  }),
  "translate-lexical": root({
    contextualMeaningZh: text(MAX_MODEL_TEXT_LENGTH),
    partOfSpeech,
    pronunciation,
    collocations: array(collocation, 3),
    contextExampleTranslationZh: nullable(text(MAX_MODEL_TEXT_LENGTH)),
    similarTerms: array(relatedTerm, 3),
  }),
  "translate-passage": root({ translationZh: text(MAX_MODEL_TEXT_LENGTH) }),
  "translate-word": root({
    pronunciation,
    contextualSense,
    dictionaryForm: englishText(120),
    commonMeanings: described(
      array(strictObject({ partOfSpeech, meaningsZh: array(text(300), 3, 1) }), 4, 1),
      "Each item contains exactly two keys in this order: partOfSpeech, meaningsZh. Never omit either key. Use one group per partOfSpeech and never repeat a partOfSpeech value.",
    ),
    commonPhrases: array(commonPhrase, 4),
    confusableWords: array(confusableWord, 4),
  }),
} as const satisfies Readonly<Record<string, JsonSchema>>;

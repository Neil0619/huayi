import { STORE_MESSAGE_VERSION, type StoreAnalysisServerMessage } from "@huayi/store-domain";

type Rule = (value: unknown) => boolean;
type OptionalField = readonly [Rule];
type Field = OptionalField | Rule;

const text =
  (maximum: number, minimum = 1): Rule =>
  (value) =>
    typeof value === "string" && value.trim().length >= minimum && value.length <= maximum;
const enumeration =
  (...values: string[]): Rule =>
  (value) =>
    typeof value === "string" && values.includes(value);
const integer =
  (minimum: number): Rule =>
  (value) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const array =
  (rule: Rule, maximum: number, minimum = 0): Rule =>
  (value) =>
    Array.isArray(value) && value.length >= minimum && value.length <= maximum && value.every(rule);
const optional = (rule: Rule): OptionalField => [rule];
const object =
  (fields: Readonly<Record<string, Field>>, minimumFields = 0): Rule =>
  (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    return (
      Object.getPrototypeOf(record) === Object.prototype &&
      keys.length >= minimumFields &&
      keys.every((key) => Object.hasOwn(fields, key)) &&
      Object.entries(fields).every(([key, field]) =>
        key in record
          ? (Array.isArray(field) ? field[0] : field)(record[key])
          : Array.isArray(field),
      )
    );
  };

const validates = (value: unknown, rule: Rule): boolean => rule(value);

const partOfSpeech = enumeration(
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
);
const sourceFields = { requestId: text(64), sourceText: text(2_000) };
const pronunciation = object({ uk: optional(text(120)), us: optional(text(120)) }, 1);
const relatedTerm = object({ meaningZh: text(200), partOfSpeech, text: text(120) });
const collocation = object({ meaningZh: text(300), text: text(200) });
const comparison = object({
  distinctionZh: text(500),
  meaningZh: text(200),
  partOfSpeech,
  text: text(120),
});
const commonMeanings = array(object({ meaningsZh: array(text(300), 3, 1), partOfSpeech }), 4, 1);
const commonPhrases = array(object({ meaningZh: text(300), text: text(200) }), 4);
const contextualSense = object({ meaningZh: text(300), partOfSpeech });
const coreMeanings = array(object({ meaningZh: text(300), partOfSpeech }), 3, 1);
const usageNotes = array(object({ descriptionZh: text(500), titleZh: text(120) }), 3);
const wordForm = object({
  baseForm: text(120),
  formTypeZh: text(300),
  sentenceRoleZh: optional(text(500)),
});
const SECTION_RULES: Readonly<Record<string, Rule>> = {
  "base-form": text(120),
  collocations: array(collocation, 3, 1),
  "common-meanings": commonMeanings,
  "common-phrases": commonPhrases,
  "confusable-words": array(comparison, 4, 1),
  "context-example": object({ english: text(2_000), translationZh: text(4_000) }),
  "contextual-sense": contextualSense,
  "core-meanings": coreMeanings,
  "part-of-speech": partOfSpeech,
  pronunciation,
  "similar-terms": array(relatedTerm, 3, 1),
  "synonym-comparisons": array(comparison, 3, 1),
  synonyms: array(relatedTerm, 3, 1),
  "usage-notes": usageNotes,
  "word-form": wordForm,
  "word-formation": text(500),
};

const RESULT_RULES: Readonly<Record<string, Rule>> = {
  "translate-word": object({
    ...sourceFields,
    commonMeanings,
    commonPhrases,
    confusableWords: array(comparison, 4),
    contextualSense,
    dictionaryForm: text(120),
    pronunciation: optional(pronunciation),
    selectionKind: enumeration("word"),
    type: enumeration("translate-word"),
  }),
  "explain-word": object({
    ...sourceFields,
    contextualAnalysisZh: text(4_000),
    selectionKind: enumeration("word"),
    synonyms: array(comparison, 3),
    type: enumeration("explain-word"),
    usageNotes,
    wordForm,
    wordFormationZh: optional(text(500)),
  }),
  "translate-lexical": object({
    ...sourceFields,
    collocations: array(collocation, 3),
    contextExample: optional(object({ english: text(2_000), translationZh: text(4_000) })),
    contextualMeaningZh: text(4_000),
    partOfSpeech,
    pronunciation: optional(pronunciation),
    selectionKind: enumeration("phrase"),
    similarTerms: array(relatedTerm, 3),
    type: enumeration("translate-lexical"),
  }),
  "explain-lexical": object({
    ...sourceFields,
    baseForm: optional(text(120)),
    collocations: array(collocation, 3),
    contextualMeaningZh: text(4_000),
    coreMeanings,
    selectionKind: enumeration("phrase"),
    synonyms: array(relatedTerm, 3),
    type: enumeration("explain-lexical"),
    wordFormation: optional(text(300)),
  }),
  "translate-passage": object({
    ...sourceFields,
    selectionKind: enumeration("sentence"),
    translationZh: text(4_000),
    type: enumeration("translate-passage"),
  }),
  "explain-sentence": object({
    ...sourceFields,
    contextRole: text(4_000),
    keyExpressions: array(object({ meaningZh: text(500), text: text(300) }), 6, 1),
    mainStructure: text(4_000),
    selectionKind: enumeration("sentence"),
    translationZh: text(4_000),
    type: enumeration("explain-sentence"),
  }),
};

const errorCode = enumeration(
  "busy",
  "cancelled",
  "consent-required",
  "credential-missing",
  "internal-error",
  "invalid-request",
  "invalid-response",
  "network-error",
  "provider-error",
  "timeout",
  "version-mismatch",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseContentAnalysisMessage(value: unknown): StoreAnalysisServerMessage {
  if (!isRecord(value) || value.messageVersion !== STORE_MESSAGE_VERSION) {
    throw new TypeError("Store analysis response is invalid.");
  }
  if (value.type === "store/analysis-update") {
    if (!isRecord(value.update)) {
      throw new TypeError("Store analysis update is invalid.");
    }
    const progress = object({
      requestId: text(64),
      stage: enumeration("queued", "running"),
      type: enumeration("progress"),
    });
    const delta = object({
      requestId: text(64),
      section: enumeration(
        "context-role",
        "contextual-analysis",
        "contextual-meaning",
        "main-structure",
        "translation",
      ),
      sequence: integer(0),
      text: text(4_096),
      type: enumeration("delta"),
    });
    const sectionRule =
      value.update.type === "section" && typeof value.update.section === "string"
        ? SECTION_RULES[value.update.section]
        : undefined;
    const section =
      sectionRule === undefined
        ? undefined
        : object({
            requestId: text(64),
            section: enumeration(value.update.section as string),
            sequence: integer(0),
            type: enumeration("section"),
            value: sectionRule,
          });
    const updateRule =
      value.update.type === "progress" ? progress : value.update.type === "delta" ? delta : section;
    if (updateRule === undefined) throw new TypeError("Store analysis update is invalid.");
    if (
      !validates(value.update, updateRule) ||
      Object.keys(value).length !== 3 ||
      Object.keys(value).some((key) => !["messageVersion", "type", "update"].includes(key))
    ) {
      throw new TypeError("Store analysis update is invalid.");
    }
    return value as unknown as StoreAnalysisServerMessage;
  }
  if (value.type === "store/analysis-result") {
    if (!isRecord(value.result)) {
      throw new TypeError("Store analysis result is invalid.");
    }
    const rule =
      typeof value.result.type === "string" ? RESULT_RULES[value.result.type] : undefined;
    if (
      rule === undefined ||
      !validates(value.result, rule) ||
      Object.keys(value).length !== 3 ||
      Object.keys(value).some((key) => !["messageVersion", "result", "type"].includes(key))
    ) {
      throw new TypeError("Store analysis result is invalid.");
    }
    return value as unknown as StoreAnalysisServerMessage;
  }
  if (
    value.type !== "store/analysis-error" ||
    Object.keys(value).length !== 4 ||
    Object.keys(value).some(
      (key) => !["code", "messageVersion", "requestId", "type"].includes(key),
    ) ||
    !errorCode(value.code) ||
    !(value.requestId === null || text(64)(value.requestId))
  ) {
    throw new TypeError("Store analysis error is invalid.");
  }
  return value as unknown as StoreAnalysisServerMessage;
}

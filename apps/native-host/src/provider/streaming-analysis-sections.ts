import { MAX_STREAM_DELTA_LENGTH } from "@huayi/protocol";
import type {
  AnalysisDeltaSection,
  AnalysisSectionPayload,
  Collocation,
  CommonPhrase,
  ConfusableWord,
  CoreMeaning,
  DictionaryMeaningGroup,
  PartOfSpeech,
  RelatedTerm,
  SynonymComparison,
  UsageNote,
} from "@huayi/protocol";

import type { AnalysisStreamUpdate } from "./analysis-provider.js";
import type {
  ModelLexicalExplanation,
  ModelLexicalTranslation,
  ModelResultType,
  ModelWordExplanation,
  ModelWordTranslation,
} from "./model-analysis-schemas.js";
import { ProviderValidationError } from "./provider-validation.js";

const TEXT_FIELDS = {
  "explain-word": new Map<string, AnalysisDeltaSection>([
    ["contextualAnalysisZh", "contextual-analysis"],
  ]),
  "explain-lexical": new Map<string, AnalysisDeltaSection>([
    ["contextualMeaningZh", "contextual-meaning"],
  ]),
  "explain-sentence": new Map<string, AnalysisDeltaSection>([
    ["mainStructure", "main-structure"],
    ["translationZh", "translation"],
    ["contextRole", "context-role"],
  ]),
  "translate-lexical": new Map<string, AnalysisDeltaSection>([
    ["contextualMeaningZh", "contextual-meaning"],
  ]),
  "translate-passage": new Map<string, AnalysisDeltaSection>([["translationZh", "translation"]]),
  "translate-word": new Map<string, AnalysisDeltaSection>(),
} satisfies Record<ModelResultType, ReadonlyMap<string, AnalysisDeltaSection>>;

export function streamingTextFieldsFor(
  resultType: ModelResultType,
): ReadonlyMap<string, AnalysisDeltaSection> {
  return TEXT_FIELDS[resultType];
}

export function splitTextDelta(
  section: AnalysisDeltaSection,
  value: string,
): AnalysisStreamUpdate[] {
  const updates: AnalysisStreamUpdate[] = [];
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(offset + MAX_STREAM_DELTA_LENGTH, value.length);
    const lastCode = value.charCodeAt(end - 1);
    const nextCode = value.charCodeAt(end);
    if (
      end < value.length &&
      lastCode >= 0xd800 &&
      lastCode <= 0xdbff &&
      nextCode >= 0xdc00 &&
      nextCode <= 0xdfff
    ) {
      end -= 1;
    }
    updates.push({ delta: value.slice(offset, end), section, type: "analysis-delta" });
    offset = end;
  }
  return updates;
}

function nonEmptyArraySection(
  section: "collocations",
  value: Collocation[],
): AnalysisSectionPayload | undefined;
function nonEmptyArraySection(
  section: "core-meanings",
  value: CoreMeaning[],
): AnalysisSectionPayload | undefined;
function nonEmptyArraySection(
  section: "similar-terms" | "synonyms",
  value: RelatedTerm[],
): AnalysisSectionPayload | undefined;
function nonEmptyArraySection(
  section: "collocations" | "core-meanings" | "similar-terms" | "synonyms",
  value: Collocation[] | CoreMeaning[] | RelatedTerm[],
): AnalysisSectionPayload | undefined {
  if (value.length === 0) return undefined;
  switch (section) {
    case "collocations":
      return { section, value: value as Collocation[] };
    case "core-meanings":
      return { section, value: value as CoreMeaning[] };
    case "similar-terms":
    case "synonyms":
      return { section, value: value as RelatedTerm[] };
  }
}

function wordArraySection(
  section: "common-meanings",
  value: DictionaryMeaningGroup[],
): AnalysisSectionPayload | undefined;
function wordArraySection(
  section: "common-phrases",
  value: CommonPhrase[],
): AnalysisSectionPayload | undefined;
function wordArraySection(
  section: "confusable-words",
  value: ConfusableWord[],
): AnalysisSectionPayload | undefined;
function wordArraySection(
  section: "usage-notes",
  value: UsageNote[],
): AnalysisSectionPayload | undefined;
function wordArraySection(
  section: "synonym-comparisons",
  value: SynonymComparison[],
): AnalysisSectionPayload | undefined;
function wordArraySection(
  section:
    | "common-meanings"
    | "common-phrases"
    | "confusable-words"
    | "usage-notes"
    | "synonym-comparisons",
  value:
    | DictionaryMeaningGroup[]
    | CommonPhrase[]
    | ConfusableWord[]
    | UsageNote[]
    | SynonymComparison[],
): AnalysisSectionPayload | undefined {
  if (value.length === 0) return undefined;
  switch (section) {
    case "common-meanings":
      return { section, value: value as DictionaryMeaningGroup[] };
    case "common-phrases":
      return { section, value: value as CommonPhrase[] };
    case "confusable-words":
      return { section, value: value as ConfusableWord[] };
    case "usage-notes":
      return { section, value: value as UsageNote[] };
    case "synonym-comparisons":
      return { section, value: value as SynonymComparison[] };
  }
}

function normalizePronunciation(
  value: ModelLexicalTranslation["pronunciation"] | ModelWordTranslation["pronunciation"],
): AnalysisSectionPayload | undefined {
  if (value === null || (value.uk === null && value.us === null)) return undefined;
  return {
    section: "pronunciation",
    value: {
      ...(value.uk === null ? {} : { uk: value.uk }),
      ...(value.us === null ? {} : { us: value.us }),
    },
  };
}

function wordTranslationSection(field: string, value: unknown): AnalysisSectionPayload | undefined {
  switch (field) {
    case "pronunciation":
      return normalizePronunciation(value as ModelWordTranslation["pronunciation"]);
    case "contextualSense":
      return {
        section: "contextual-sense",
        value: value as ModelWordTranslation["contextualSense"],
      };
    case "commonMeanings":
      return wordArraySection("common-meanings", value as DictionaryMeaningGroup[]);
    case "commonPhrases":
      return wordArraySection("common-phrases", value as CommonPhrase[]);
    case "confusableWords":
      return wordArraySection("confusable-words", value as ConfusableWord[]);
    default:
      return undefined;
  }
}

function wordExplanationSection(field: string, value: unknown): AnalysisSectionPayload | undefined {
  switch (field) {
    case "wordForm": {
      const wordForm = value as ModelWordExplanation["wordForm"];
      return {
        section: "word-form",
        value: {
          baseForm: wordForm.baseForm,
          formTypeZh: wordForm.formTypeZh,
          ...(wordForm.sentenceRoleZh === null ? {} : { sentenceRoleZh: wordForm.sentenceRoleZh }),
        },
      };
    }
    case "wordFormationZh":
      return value === null ? undefined : { section: "word-formation", value: value as string };
    case "usageNotes":
      return wordArraySection("usage-notes", value as UsageNote[]);
    case "synonyms":
      return wordArraySection("synonym-comparisons", value as SynonymComparison[]);
    default:
      return undefined;
  }
}

function lexicalTranslationSection(
  field: string,
  value: unknown,
  sentenceContext: string | null,
): AnalysisSectionPayload | undefined {
  switch (field) {
    case "partOfSpeech":
      return { section: "part-of-speech", value: value as PartOfSpeech };
    case "pronunciation":
      return normalizePronunciation(value as ModelLexicalTranslation["pronunciation"]);
    case "collocations":
      return nonEmptyArraySection("collocations", value as Collocation[]);
    case "contextExampleTranslationZh": {
      const translationZh = value as string | null;
      if (translationZh === null) return undefined;
      if (sentenceContext === null) throw new ProviderValidationError("result-assembly", { field });
      return {
        section: "context-example",
        value: { english: sentenceContext, translationZh },
      };
    }
    case "similarTerms":
      return nonEmptyArraySection("similar-terms", value as RelatedTerm[]);
    default:
      return undefined;
  }
}

function lexicalExplanationSection(
  field: string,
  value: unknown,
): AnalysisSectionPayload | undefined {
  switch (field) {
    case "baseForm":
      return value === null
        ? undefined
        : { section: "base-form", value: value as ModelLexicalExplanation["baseForm"] & string };
    case "wordFormation":
      return value === null ? undefined : { section: "word-formation", value: value as string };
    case "coreMeanings":
      return nonEmptyArraySection("core-meanings", value as CoreMeaning[]);
    case "collocations":
      return nonEmptyArraySection("collocations", value as Collocation[]);
    case "synonyms":
      return nonEmptyArraySection("synonyms", value as RelatedTerm[]);
    default:
      return undefined;
  }
}

export function structuredSectionFor(
  resultType: ModelResultType,
  field: string,
  value: unknown,
  sentenceContext: string | null,
): AnalysisSectionPayload | undefined {
  switch (resultType) {
    case "translate-word":
      return wordTranslationSection(field, value);
    case "translate-lexical":
      return lexicalTranslationSection(field, value, sentenceContext);
    case "explain-word":
      return wordExplanationSection(field, value);
    case "explain-lexical":
      return lexicalExplanationSection(field, value);
    case "explain-sentence":
    case "translate-passage":
      return undefined;
  }
}

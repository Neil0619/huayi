import {
  MAX_STREAM_DELTA_LENGTH,
  type AnalysisResult,
  type AnalysisUpdate,
  type PartOfSpeech,
  type Pronunciation,
} from "@huayi/store-domain";

import type { ModelResultType } from "./model-contracts.js";

type WithoutEnvelope<Update> = Update extends unknown
  ? Omit<Update, "requestId" | "sequence">
  : never;

export type PreviewUpdate = WithoutEnvelope<Exclude<AnalysisUpdate, { type: "progress" }>>;
type SectionPreview = Extract<PreviewUpdate, { type: "section" }>;
type DeltaSection = Extract<PreviewUpdate, { type: "delta" }>["section"];

type WordTranslation = Extract<AnalysisResult, { type: "translate-word" }>;
type WordExplanation = Extract<AnalysisResult, { type: "explain-word" }>;
type LexicalTranslation = Extract<AnalysisResult, { type: "translate-lexical" }>;
type LexicalExplanation = Extract<AnalysisResult, { type: "explain-lexical" }>;

const TEXT_FIELDS = {
  "explain-lexical": new Map<string, DeltaSection>([["contextualMeaningZh", "contextual-meaning"]]),
  "explain-sentence": new Map<string, DeltaSection>([
    ["mainStructure", "main-structure"],
    ["translationZh", "translation"],
    ["contextRole", "context-role"],
  ]),
  "explain-word": new Map<string, DeltaSection>([["contextualAnalysisZh", "contextual-analysis"]]),
  "translate-lexical": new Map<string, DeltaSection>([
    ["contextualMeaningZh", "contextual-meaning"],
  ]),
  "translate-passage": new Map<string, DeltaSection>([["translationZh", "translation"]]),
  "translate-word": new Map<string, DeltaSection>(),
} satisfies Record<ModelResultType, ReadonlyMap<string, DeltaSection>>;

export function streamingTextFieldsFor(type: ModelResultType): ReadonlyMap<string, DeltaSection> {
  return TEXT_FIELDS[type];
}

export function splitTextDelta(section: DeltaSection, value: string): PreviewUpdate[] {
  const updates: PreviewUpdate[] = [];
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(offset + MAX_STREAM_DELTA_LENGTH, value.length);
    const last = value.charCodeAt(end - 1);
    const next = value.charCodeAt(end);
    if (
      end < value.length &&
      last >= 0xd800 &&
      last <= 0xdbff &&
      next >= 0xdc00 &&
      next <= 0xdfff
    ) {
      end -= 1;
    }
    updates.push({ section, text: value.slice(offset, end), type: "delta" });
    offset = end;
  }
  return updates;
}

function nonEmpty<Section extends SectionPreview["section"]>(
  section: Section,
  value: Extract<SectionPreview, { section: Section }>["value"],
): SectionPreview | undefined {
  return Array.isArray(value) && value.length === 0
    ? undefined
    : ({ section, type: "section", value } as SectionPreview);
}

function pronunciation(value: { uk: string | null; us: string | null } | null) {
  if (value === null || (value.uk === null && value.us === null)) return undefined;
  const normalized: Pronunciation = {
    ...(value.uk === null ? {} : { uk: value.uk }),
    ...(value.us === null ? {} : { us: value.us }),
  };
  return nonEmpty("pronunciation", normalized);
}

function wordTranslationSection(field: string, value: unknown): SectionPreview | undefined {
  switch (field) {
    case "pronunciation":
      return pronunciation(value as { uk: string | null; us: string | null } | null);
    case "contextualSense":
      return nonEmpty("contextual-sense", value as WordTranslation["contextualSense"]);
    case "commonMeanings":
      return nonEmpty("common-meanings", value as WordTranslation["commonMeanings"]);
    case "commonPhrases":
      return nonEmpty("common-phrases", value as WordTranslation["commonPhrases"]);
    case "confusableWords":
      return nonEmpty("confusable-words", value as WordTranslation["confusableWords"]);
    default:
      return undefined;
  }
}

function wordExplanationSection(field: string, value: unknown): SectionPreview | undefined {
  switch (field) {
    case "wordForm": {
      const wordForm = value as WordExplanation["wordForm"] & { sentenceRoleZh?: string | null };
      return nonEmpty("word-form", {
        baseForm: wordForm.baseForm,
        formTypeZh: wordForm.formTypeZh,
        ...(wordForm.sentenceRoleZh === null || wordForm.sentenceRoleZh === undefined
          ? {}
          : { sentenceRoleZh: wordForm.sentenceRoleZh }),
      });
    }
    case "wordFormationZh":
      return value === null ? undefined : nonEmpty("word-formation", value as string);
    case "usageNotes":
      return nonEmpty("usage-notes", value as WordExplanation["usageNotes"]);
    case "synonyms":
      return nonEmpty("synonym-comparisons", value as WordExplanation["synonyms"]);
    default:
      return undefined;
  }
}

function lexicalTranslationSection(
  field: string,
  value: unknown,
  sentenceContext: string | null,
): SectionPreview | undefined {
  switch (field) {
    case "partOfSpeech":
      return nonEmpty("part-of-speech", value as PartOfSpeech);
    case "pronunciation":
      return pronunciation(value as { uk: string | null; us: string | null } | null);
    case "collocations":
      return nonEmpty("collocations", value as LexicalTranslation["collocations"]);
    case "contextExampleTranslationZh":
      return value === null || sentenceContext === null
        ? undefined
        : nonEmpty("context-example", { english: sentenceContext, translationZh: value as string });
    case "similarTerms":
      return nonEmpty("similar-terms", value as LexicalTranslation["similarTerms"]);
    default:
      return undefined;
  }
}

function lexicalExplanationSection(field: string, value: unknown): SectionPreview | undefined {
  switch (field) {
    case "baseForm":
      return value === null ? undefined : nonEmpty("base-form", value as string);
    case "wordFormation":
      return value === null ? undefined : nonEmpty("word-formation", value as string);
    case "coreMeanings":
      return nonEmpty("core-meanings", value as LexicalExplanation["coreMeanings"]);
    case "collocations":
      return nonEmpty("collocations", value as LexicalExplanation["collocations"]);
    case "synonyms":
      return nonEmpty("synonyms", value as LexicalExplanation["synonyms"]);
    default:
      return undefined;
  }
}

export function structuredSectionFor(
  type: ModelResultType,
  field: string,
  value: unknown,
  sentenceContext: string | null,
): SectionPreview | undefined {
  switch (type) {
    case "translate-word":
      return wordTranslationSection(field, value);
    case "explain-word":
      return wordExplanationSection(field, value);
    case "translate-lexical":
      return lexicalTranslationSection(field, value, sentenceContext);
    case "explain-lexical":
      return lexicalExplanationSection(field, value);
    case "explain-sentence":
    case "translate-passage":
      return undefined;
  }
}

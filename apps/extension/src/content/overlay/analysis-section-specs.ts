import type { AnalysisResult, PartOfSpeech, Pronunciation } from "@huayi/protocol";

import type { ErrorOverlayState, StreamingOverlayState } from "./overlay-state.js";
import { partOfSpeechLabels } from "./render-analysis-sections.js";
import type {
  ContextSectionSpec,
  EntryLayout,
  EntrySectionSpec,
  ListSectionSpec,
  PronunciationSectionSpec,
  SectionEntry,
  SectionSpec,
  TextSectionSpec,
} from "./analysis-section-types.js";

function text(key: string, title: string, value: string | null | undefined): TextSectionSpec {
  return { key, kind: "text", title, value };
}

function context(
  key: string,
  title: string,
  value: string | null | undefined,
  badge?: string,
): ContextSectionSpec {
  return { badge, key, kind: "context", title, value };
}

function pronunciation(value: Pronunciation | null | undefined): PronunciationSectionSpec {
  return { key: "pronunciation", kind: "pronunciation", value: pronunciationText(value) };
}

function list(
  key: string,
  title: string,
  values: readonly string[] | null | undefined,
  termList = false,
): ListSectionSpec {
  return { key, kind: "list", termList, title, values };
}

function entries(
  key: string,
  title: string,
  layout: EntryLayout,
  values: readonly SectionEntry[] | null | undefined,
): EntrySectionSpec {
  return { key, kind: "entries", layout, title, values };
}

function pronunciationText(value: Pronunciation | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return [
    value.uk === undefined ? undefined : `英 ${value.uk}`,
    value.us === undefined ? undefined : `美 ${value.us}`,
  ]
    .filter((item): item is string => item !== undefined)
    .join("　");
}

function partOfSpeechText(value: PartOfSpeech | undefined): string | undefined {
  return value === undefined ? undefined : partOfSpeechLabels[value];
}

function comparisonEntry(value: {
  distinctionZh: string;
  meaningZh: string;
  partOfSpeech: PartOfSpeech;
  text: string;
}): SectionEntry {
  return {
    badge: partOfSpeechLabels[value.partOfSpeech],
    detail: value.distinctionZh,
    primary: value.text,
    secondary: value.meaningZh,
  };
}

function wordFormEntries(value: {
  baseForm: string;
  formTypeZh: string;
  sentenceRoleZh?: string | undefined;
}): SectionEntry[] {
  const values: SectionEntry[] = [
    { primary: "原形", secondary: value.baseForm },
    { primary: "当前形式", secondary: value.formTypeZh },
  ];
  if (value.sentenceRoleZh !== undefined) {
    values.push({ primary: "句法作用", secondary: value.sentenceRoleZh });
  }
  return values;
}

function wordTranslationSections(
  result: Extract<AnalysisResult, { type: "translate-word" }>,
): SectionSpec[] {
  return [
    pronunciation(result.pronunciation),
    context(
      "contextual-sense",
      "语境义",
      result.contextualSense.meaningZh,
      partOfSpeechLabels[result.contextualSense.partOfSpeech],
    ),
    entries(
      "common-meanings",
      "常见释义",
      "definitions",
      result.commonMeanings.map((group) => ({
        badge: partOfSpeechLabels[group.partOfSpeech],
        primary: group.meaningsZh.join("；"),
      })),
    ),
    entries(
      "common-phrases",
      "常用短语",
      "pairs",
      result.commonPhrases.map((item) => ({ primary: item.text, secondary: item.meaningZh })),
    ),
    entries(
      "confusable-words",
      "易混词",
      "comparisons",
      result.confusableWords.map(comparisonEntry),
    ),
  ];
}

function wordExplanationSections(
  result: Extract<AnalysisResult, { type: "explain-word" }>,
): SectionSpec[] {
  return [
    context("contextual-analysis", "语境解析", result.contextualAnalysisZh),
    entries("word-form", "词形解析", "details", wordFormEntries(result.wordForm)),
    text("word-formation", "构词解析", result.wordFormationZh),
    entries(
      "usage-notes",
      "用法要点",
      "details",
      result.usageNotes.map((item) => ({
        primary: item.titleZh,
        secondary: item.descriptionZh,
      })),
    ),
    entries(
      "synonym-comparisons",
      "同义词辨析",
      "comparisons",
      result.synonyms.map(comparisonEntry),
    ),
  ];
}

export function resultSections(result: AnalysisResult): SectionSpec[] {
  switch (result.type) {
    case "translate-word":
      return wordTranslationSections(result);
    case "translate-lexical":
      return [
        text("contextual-meaning", "语境义", result.contextualMeaningZh),
        text("part-of-speech", "词性", partOfSpeechText(result.partOfSpeech)),
        text("pronunciation", "音标", pronunciationText(result.pronunciation)),
        list(
          "collocations",
          "语境搭配",
          result.collocations.map((item) => `${item.text}（${item.meaningZh}）`),
        ),
        text(
          "context-example",
          "原文例句",
          result.contextExample === undefined
            ? undefined
            : `${result.contextExample.english}\n${result.contextExample.translationZh}`,
        ),
        list(
          "similar-terms",
          "相似词",
          result.similarTerms.map(
            (item) => `${item.text} · ${partOfSpeechLabels[item.partOfSpeech]} · ${item.meaningZh}`,
          ),
          true,
        ),
      ];
    case "translate-passage":
      return [text("translation", "译文", result.translationZh)];
    case "explain-lexical":
      return [
        text("contextual-meaning", "语境义", result.contextualMeaningZh),
        text("base-form", "原形", result.baseForm),
        text("word-formation", "构词", result.wordFormation),
        list(
          "core-meanings",
          "核心词义",
          result.coreMeanings.map(
            (item) => `${partOfSpeechLabels[item.partOfSpeech]} ${item.meaningZh}`,
          ),
        ),
        list(
          "collocations",
          "语境搭配",
          result.collocations.map((item) => `${item.text}（${item.meaningZh}）`),
        ),
        list(
          "synonyms",
          "同义词",
          result.synonyms.map(
            (item) => `${item.text} · ${partOfSpeechLabels[item.partOfSpeech]} · ${item.meaningZh}`,
          ),
          true,
        ),
      ];
    case "explain-word":
      return wordExplanationSections(result);
    case "explain-sentence":
      return [
        text("main-structure", "句子主干", result.mainStructure),
        list(
          "key-expressions",
          "关键表达",
          result.keyExpressions.map((item) => `${item.text}：${item.meaningZh}`),
        ),
        text("translation", "句意翻译", result.translationZh),
        text("context-role", "语境作用", result.contextRole),
      ];
  }
}

function wordTranslationPreview(state: StreamingOverlayState | ErrorOverlayState): SectionSpec[] {
  const { sections } = state.preview;
  return [
    pronunciation(sections.pronunciation),
    context(
      "contextual-sense",
      "语境义",
      sections.contextualSense?.meaningZh,
      sections.contextualSense === undefined
        ? undefined
        : partOfSpeechLabels[sections.contextualSense.partOfSpeech],
    ),
    entries(
      "common-meanings",
      "常见释义",
      "definitions",
      sections.commonMeanings?.map((group) => ({
        badge: partOfSpeechLabels[group.partOfSpeech],
        primary: group.meaningsZh.join("；"),
      })),
    ),
    entries(
      "common-phrases",
      "常用短语",
      "pairs",
      sections.commonPhrases?.map((item) => ({ primary: item.text, secondary: item.meaningZh })),
    ),
    entries(
      "confusable-words",
      "易混词",
      "comparisons",
      sections.confusableWords?.map(comparisonEntry),
    ),
  ];
}

function wordExplanationPreview(state: StreamingOverlayState | ErrorOverlayState): SectionSpec[] {
  const { sections, text: deltas } = state.preview;
  return [
    context("contextual-analysis", "语境解析", deltas["contextual-analysis"]),
    entries(
      "word-form",
      "词形解析",
      "details",
      sections.wordForm === undefined ? undefined : wordFormEntries(sections.wordForm),
    ),
    text("word-formation", "构词解析", sections.wordFormation),
    entries(
      "usage-notes",
      "用法要点",
      "details",
      sections.usageNotes?.map((item) => ({
        primary: item.titleZh,
        secondary: item.descriptionZh,
      })),
    ),
    entries(
      "synonym-comparisons",
      "同义词辨析",
      "comparisons",
      sections.synonymComparisons?.map(comparisonEntry),
    ),
  ];
}

export function previewSections(state: StreamingOverlayState | ErrorOverlayState): SectionSpec[] {
  const { sections, text: deltas } = state.preview;
  if (state.action === "translate" && state.selection.selectionKind === "word") {
    return wordTranslationPreview(state);
  }
  if (state.action === "explain" && state.selection.selectionKind === "word") {
    return wordExplanationPreview(state);
  }
  if (state.action === "translate" && state.selection.selectionKind === "phrase") {
    return [
      text("contextual-meaning", "语境义", deltas["contextual-meaning"]),
      text("part-of-speech", "词性", partOfSpeechText(sections.partOfSpeech)),
      text("pronunciation", "音标", pronunciationText(sections.pronunciation)),
      list(
        "collocations",
        "语境搭配",
        sections.collocations?.map((item) => `${item.text}（${item.meaningZh}）`),
      ),
      text(
        "context-example",
        "原文例句",
        sections.contextExample === undefined
          ? undefined
          : `${sections.contextExample.english}\n${sections.contextExample.translationZh}`,
      ),
      list(
        "similar-terms",
        "相似词",
        sections.similarTerms?.map(
          (item) => `${item.text} · ${partOfSpeechLabels[item.partOfSpeech]} · ${item.meaningZh}`,
        ),
        true,
      ),
      text("translation", "译文", deltas.translation),
      text("main-structure", "句子主干", deltas["main-structure"]),
      text("context-role", "语境作用", deltas["context-role"]),
    ];
  }
  if (state.action === "explain" && state.selection.selectionKind === "phrase") {
    return [
      text("contextual-meaning", "语境义", deltas["contextual-meaning"]),
      text("base-form", "原形", sections.baseForm),
      text("word-formation", "构词", sections.wordFormation),
      list(
        "core-meanings",
        "核心词义",
        sections.coreMeanings?.map(
          (item) => `${partOfSpeechLabels[item.partOfSpeech]} ${item.meaningZh}`,
        ),
      ),
      list(
        "collocations",
        "语境搭配",
        sections.collocations?.map((item) => `${item.text}（${item.meaningZh}）`),
      ),
      list(
        "synonyms",
        "同义词",
        sections.synonyms?.map(
          (item) => `${item.text} · ${partOfSpeechLabels[item.partOfSpeech]} · ${item.meaningZh}`,
        ),
        true,
      ),
      text("translation", "译文", deltas.translation),
      text("main-structure", "句子主干", deltas["main-structure"]),
      text("context-role", "语境作用", deltas["context-role"]),
    ];
  }
  return state.action === "translate"
    ? [text("translation", "译文", deltas.translation)]
    : [
        text("main-structure", "句子主干", deltas["main-structure"]),
        text("translation", "句意翻译", deltas.translation),
        text("context-role", "语境作用", deltas["context-role"]),
      ];
}

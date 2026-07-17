import type { AnalysisResult, PartOfSpeech, Pronunciation } from "@huayi/protocol";

import type { ErrorOverlayState, StreamingOverlayState } from "./overlay-state.js";
import { partOfSpeechLabels } from "./render-analysis-sections.js";

export interface TextSectionSpec {
  key: string;
  kind: "text";
  title: string;
  value: string | null | undefined;
}

export interface ListSectionSpec {
  key: string;
  kind: "list";
  termList?: boolean;
  title: string;
  values: readonly string[] | null | undefined;
}

export type SectionSpec = TextSectionSpec | ListSectionSpec;

function text(key: string, title: string, value: string | null | undefined): TextSectionSpec {
  return { key, kind: "text", title, value };
}

function list(
  key: string,
  title: string,
  values: readonly string[] | null | undefined,
  termList = false,
): ListSectionSpec {
  return { key, kind: "list", termList, title, values };
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

function comparisonText(value: {
  distinctionZh: string;
  meaningZh: string;
  partOfSpeech: PartOfSpeech;
  text: string;
}): string {
  return `${value.text} · ${partOfSpeechLabels[value.partOfSpeech]} · ${value.meaningZh}\n区别：${value.distinctionZh}`;
}

function wordFormText(value: {
  baseForm: string;
  formTypeZh: string;
  sentenceRoleZh?: string | undefined;
}): string {
  return [
    `原形：${value.baseForm}`,
    `当前形式：${value.formTypeZh}`,
    value.sentenceRoleZh === undefined ? undefined : `句法作用：${value.sentenceRoleZh}`,
  ]
    .filter((item): item is string => item !== undefined)
    .join("\n");
}

export function resultSections(result: AnalysisResult): SectionSpec[] {
  switch (result.type) {
    case "translate-word":
      return [
        text("pronunciation", "音标", pronunciationText(result.pronunciation)),
        text(
          "contextual-sense",
          "语境义",
          `${partOfSpeechLabels[result.contextualSense.partOfSpeech]} ${result.contextualSense.meaningZh}`,
        ),
        list(
          "common-meanings",
          "常见释义",
          result.commonMeanings.map(
            (group) => `${partOfSpeechLabels[group.partOfSpeech]} ${group.meaningsZh.join("；")}`,
          ),
        ),
        list(
          "common-phrases",
          "常用短语",
          result.commonPhrases.map((item) => `${item.text}（${item.meaningZh}）`),
        ),
        list("confusable-words", "易混词", result.confusableWords.map(comparisonText), true),
      ];
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
      return [
        text("contextual-analysis", "语境解析", result.contextualAnalysisZh),
        text("word-form", "词形解析", wordFormText(result.wordForm)),
        text("word-formation", "构词解析", result.wordFormationZh),
        list(
          "usage-notes",
          "用法要点",
          result.usageNotes.map((item) => `${item.titleZh}：${item.descriptionZh}`),
        ),
        list("synonym-comparisons", "同义词辨析", result.synonyms.map(comparisonText), true),
      ];
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

export function previewSections(state: StreamingOverlayState | ErrorOverlayState): SectionSpec[] {
  const { sections, text: deltas } = state.preview;
  if (state.action === "translate" && state.selection.selectionKind === "word") {
    return [
      text("pronunciation", "音标", pronunciationText(sections.pronunciation)),
      text(
        "contextual-sense",
        "语境义",
        sections.contextualSense === undefined
          ? undefined
          : `${partOfSpeechLabels[sections.contextualSense.partOfSpeech]} ${sections.contextualSense.meaningZh}`,
      ),
      list(
        "common-meanings",
        "常见释义",
        sections.commonMeanings?.map(
          (group) => `${partOfSpeechLabels[group.partOfSpeech]} ${group.meaningsZh.join("；")}`,
        ),
      ),
      list(
        "common-phrases",
        "常用短语",
        sections.commonPhrases?.map((item) => `${item.text}（${item.meaningZh}）`),
      ),
      list("confusable-words", "易混词", sections.confusableWords?.map(comparisonText), true),
    ];
  }
  if (state.action === "explain" && state.selection.selectionKind === "word") {
    return [
      text("contextual-analysis", "语境解析", deltas["contextual-analysis"]),
      text(
        "word-form",
        "词形解析",
        sections.wordForm === undefined ? undefined : wordFormText(sections.wordForm),
      ),
      text("word-formation", "构词解析", sections.wordFormation),
      list(
        "usage-notes",
        "用法要点",
        sections.usageNotes?.map((item) => `${item.titleZh}：${item.descriptionZh}`),
      ),
      list(
        "synonym-comparisons",
        "同义词辨析",
        sections.synonymComparisons?.map(comparisonText),
        true,
      ),
    ];
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

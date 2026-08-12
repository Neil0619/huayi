import type {
  AnalysisResult,
  AnalysisUpdate,
  PartOfSpeech,
  Pronunciation,
} from "@huayi/store-domain";

export type ResultEntryLayout = "comparisons" | "definitions" | "details" | "pairs";

export type ResultEntry = readonly [string, (string | undefined)?, (string | undefined)?, string?];

export type ResultSection =
  | readonly ["callout", string, string, string, string | undefined]
  | readonly ["entries", string, string, ResultEntryLayout, readonly ResultEntry[]]
  | readonly ["list", string, string, readonly string[]]
  | readonly ["text", string, string, string];

const partOfSpeechLabel = (value: PartOfSpeech): string => {
  const abbreviations: Partial<Record<PartOfSpeech, string>> = {
    adjective: "adj.",
    adverb: "adv.",
    conjunction: "conj.",
    determiner: "det.",
    interjection: "interj.",
    noun: "n.",
    number: "num.",
    preposition: "prep.",
    pronoun: "pron.",
    verb: "v.",
  };
  return abbreviations[value] ?? value;
};

function text(key: string, title: string, value: string | undefined): ResultSection | null {
  return value === undefined || value.length === 0 ? null : ["text", key, title, value];
}

function callout(key: string, title: string, value: string, badge?: string): ResultSection {
  return ["callout", key, title, value, badge];
}

function entries(
  key: string,
  title: string,
  layout: ResultEntryLayout,
  values: readonly ResultEntry[],
): ResultSection | null {
  return values.length === 0 ? null : ["entries", key, title, layout, values];
}

function list(key: string, title: string, values: readonly string[]): ResultSection | null {
  return values.length === 0 ? null : ["list", key, title, values];
}

function pronunciationText(value: Pronunciation | undefined): string | undefined {
  if (value === undefined) return undefined;
  return [
    value.uk === undefined ? undefined : `英 ${value.uk}`,
    value.us === undefined ? undefined : `美 ${value.us}`,
  ]
    .filter((item): item is string => item !== undefined)
    .join("　");
}

function comparison(value: {
  distinctionZh: string;
  meaningZh: string;
  partOfSpeech: PartOfSpeech;
  text: string;
}): ResultEntry {
  return [value.text, value.meaningZh, partOfSpeechLabel(value.partOfSpeech), value.distinctionZh];
}

function present(sections: readonly (ResultSection | null)[]): ResultSection[] {
  return sections.filter((section): section is ResultSection => section !== null);
}

function structured(section: SectionUpdate["section"], value: unknown): ResultSection | null {
  if (value === undefined) return null;
  return previewStructuredSection({ section, value } as SectionUpdate);
}

export function resultHeading(result: AnalysisResult): string | null {
  if (result.type === "translate-word") return result.dictionaryForm;
  if (result.type === "explain-word") return result.wordForm.baseForm;
  if (result.selectionKind === "phrase") return result.sourceText;
  return null;
}

export function resultSections(result: AnalysisResult): ResultSection[] {
  switch (result.type) {
    case "translate-word":
      return present([
        structured("pronunciation", result.pronunciation),
        structured("contextual-sense", result.contextualSense),
        structured("common-meanings", result.commonMeanings),
        structured("common-phrases", result.commonPhrases),
        structured("confusable-words", result.confusableWords),
      ]);
    case "explain-word":
      return present([
        previewTextSection("contextual-analysis", result.contextualAnalysisZh),
        structured("word-form", result.wordForm),
        structured("word-formation", result.wordFormationZh),
        structured("usage-notes", result.usageNotes),
        structured("synonym-comparisons", result.synonyms),
      ]);
    case "translate-lexical":
      return present([
        callout("contextual-meaning", "语境义", result.contextualMeaningZh),
        structured("part-of-speech", result.partOfSpeech),
        structured("pronunciation", result.pronunciation),
        structured("collocations", result.collocations),
        structured("context-example", result.contextExample),
        structured("similar-terms", result.similarTerms),
      ]);
    case "explain-lexical":
      return present([
        callout("contextual-meaning", "语境义", result.contextualMeaningZh),
        structured("base-form", result.baseForm),
        structured("word-formation", result.wordFormation),
        structured("core-meanings", result.coreMeanings),
        structured("collocations", result.collocations),
        structured("synonyms", result.synonyms),
      ]);
    case "translate-passage":
      return [["text", "translation", "译文", result.translationZh]];
    case "explain-sentence":
      return present([
        text("main-structure", "句子主干", result.mainStructure),
        entries(
          "key-expressions",
          "关键表达",
          "pairs",
          result.keyExpressions.map((item) => [item.text, item.meaningZh]),
        ),
        text("translation", "句意翻译", result.translationZh),
        text("context-role", "语境作用", result.contextRole),
      ]);
  }
}

type SectionUpdate = Extract<AnalysisUpdate, { type: "section" }>;

export function previewTextSection(
  section: Extract<AnalysisUpdate, { type: "delta" }>["section"],
  value: string,
): ResultSection {
  const labels = {
    "context-role": "语境作用",
    "contextual-analysis": "语境解析",
    "contextual-meaning": "语境义",
    "main-structure": "句子主干",
    translation: "译文",
  } as const;
  return section === "contextual-analysis" || section === "contextual-meaning"
    ? callout(section, labels[section], value)
    : ["text", section, labels[section], value];
}

export function previewStructuredSection(update: SectionUpdate): ResultSection | null {
  switch (update.section) {
    case "pronunciation":
      return text("pronunciation", "音标", pronunciationText(update.value));
    case "contextual-sense":
      return callout(
        "contextual-sense",
        "语境义",
        update.value.meaningZh,
        partOfSpeechLabel(update.value.partOfSpeech),
      );
    case "common-meanings":
      return entries(
        "common-meanings",
        "常见释义",
        "definitions",
        update.value.map((group) => [
          group.meaningsZh.join("；"),
          undefined,
          partOfSpeechLabel(group.partOfSpeech),
        ]),
      );
    case "common-phrases":
      return entries(
        "common-phrases",
        "常用短语",
        "pairs",
        update.value.map((item) => [item.text, item.meaningZh]),
      );
    case "confusable-words":
      return entries("confusable-words", "易混词", "comparisons", update.value.map(comparison));
    case "word-form":
      return entries("word-form", "词形解析", "details", [
        ["原形", update.value.baseForm],
        ["当前形式", update.value.formTypeZh],
        ...(update.value.sentenceRoleZh === undefined
          ? []
          : [["句法作用", update.value.sentenceRoleZh] as const]),
      ]);
    case "word-formation":
      return text("word-formation", "构词解析", update.value);
    case "usage-notes":
      return entries(
        "usage-notes",
        "用法要点",
        "details",
        update.value.map((item) => [item.titleZh, item.descriptionZh]),
      );
    case "synonym-comparisons":
      return entries(
        "synonym-comparisons",
        "同义词辨析",
        "comparisons",
        update.value.map(comparison),
      );
    case "part-of-speech":
      return text("part-of-speech", "词性", partOfSpeechLabel(update.value));
    case "collocations":
      return entries(
        "collocations",
        "语境搭配",
        "pairs",
        update.value.map((item) => [item.text, item.meaningZh]),
      );
    case "context-example":
      return text(
        "context-example",
        "原文例句",
        `${update.value.english}\n${update.value.translationZh}`,
      );
    case "similar-terms":
      return list(
        "similar-terms",
        "相似词",
        update.value.map(
          (item) => `${item.text} · ${partOfSpeechLabel(item.partOfSpeech)} · ${item.meaningZh}`,
        ),
      );
    case "base-form":
      return text("base-form", "原形", update.value);
    case "core-meanings":
      return list(
        "core-meanings",
        "核心词义",
        update.value.map((item) => `${partOfSpeechLabel(item.partOfSpeech)} ${item.meaningZh}`),
      );
    case "synonyms":
      return list(
        "synonyms",
        "同义词",
        update.value.map(
          (item) => `${item.text} · ${partOfSpeechLabel(item.partOfSpeech)} · ${item.meaningZh}`,
        ),
      );
  }
}

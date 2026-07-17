import type {
  Collocation,
  ContextExample,
  CoreMeaning,
  PartOfSpeech,
  Pronunciation,
  RelatedTerm,
} from "@huayi/protocol";

export const partOfSpeechLabels: Record<PartOfSpeech, string> = {
  adjective: "adj.",
  adverb: "adv.",
  conjunction: "conj.",
  determiner: "det.",
  interjection: "interj.",
  modal: "modal",
  noun: "n.",
  number: "num.",
  other: "other",
  particle: "particle",
  phrase: "phrase",
  preposition: "prep.",
  pronoun: "pron.",
  verb: "v.",
};

function createSection(body: HTMLElement, title: string): HTMLElement {
  const section = body.ownerDocument.createElement("section");
  section.className = "huayi-section";
  section.dataset.huayiSection = sectionKeys[title] ?? title;

  const heading = body.ownerDocument.createElement("h3");
  heading.className = "huayi-section-title";
  heading.textContent = title;
  section.append(heading);
  body.append(section);
  return section;
}

const sectionKeys: Record<string, string> = {
  常用短语: "common-phrases",
  常见释义: "common-meanings",
  词形解析: "word-form",
  同义词辨析: "synonym-comparisons",
  易混词: "confusable-words",
  用法要点: "usage-notes",
  语境解析: "contextual-analysis",
  原形: "base-form",
  原文例句: "context-example",
  句子主干: "main-structure",
  句意翻译: "translation",
  同义词: "synonyms",
  核心词义: "core-meanings",
  构词: "word-formation",
  相似词: "similar-terms",
  语境义: "contextual-meaning",
  语境作用: "context-role",
  语境搭配: "collocations",
  译文: "translation",
  关键表达: "key-expressions",
  词性: "part-of-speech",
  音标: "pronunciation",
};

export function appendSource(body: HTMLElement, sourceText: string): void {
  const source = body.ownerDocument.createElement("p");
  source.className = "huayi-source";
  source.dataset.huayiSection = "source";
  source.dataset.huayiValue = "";
  source.textContent = sourceText;
  body.append(source);
}

export function appendTextSection(
  body: HTMLElement,
  title: string,
  value: string | null | undefined,
): void {
  if (value === null || value === undefined || value.length === 0) {
    return;
  }
  const section = createSection(body, title);
  const copy = body.ownerDocument.createElement("p");
  copy.className = "huayi-copy";
  copy.dataset.huayiValue = "";
  copy.textContent = value;
  section.append(copy);
}

export function appendStringListSection(
  body: HTMLElement,
  title: string,
  values: readonly string[] | null | undefined,
): void {
  if (values === null || values === undefined || values.length === 0) {
    return;
  }
  const section = createSection(body, title);
  const list = body.ownerDocument.createElement("ul");
  list.className = "huayi-list";
  for (const [index, value] of values.entries()) {
    const item = body.ownerDocument.createElement("li");
    item.dataset.huayiItem = String(index);
    item.textContent = value;
    list.append(item);
  }
  section.append(list);
}

export function appendPartOfSpeech(body: HTMLElement, value: PartOfSpeech | undefined): void {
  if (value !== undefined) {
    appendTextSection(body, "词性", partOfSpeechLabels[value]);
  }
}

export function appendPronunciation(
  body: HTMLElement,
  value: Pronunciation | null | undefined,
): void {
  if (value === null || value === undefined) {
    return;
  }
  const pronunciations = [
    value.uk === undefined ? undefined : `英 ${value.uk}`,
    value.us === undefined ? undefined : `美 ${value.us}`,
  ].filter((item): item is string => item !== undefined);
  appendTextSection(body, "音标", pronunciations.join("　"));
}

export function appendCollocations(
  body: HTMLElement,
  values: readonly Collocation[] | null | undefined,
): void {
  appendStringListSection(
    body,
    "语境搭配",
    values?.map((item) => `${item.text}（${item.meaningZh}）`),
  );
}

export function appendContextExample(
  body: HTMLElement,
  value: ContextExample | null | undefined,
): void {
  if (value !== null && value !== undefined) {
    appendTextSection(body, "原文例句", `${value.english}\n${value.translationZh}`);
  }
}

export function appendCoreMeanings(
  body: HTMLElement,
  values: readonly CoreMeaning[] | null | undefined,
): void {
  appendStringListSection(
    body,
    "核心词义",
    values?.map((meaning) => `${partOfSpeechLabels[meaning.partOfSpeech]} ${meaning.meaningZh}`),
  );
}

export function appendRelatedTerms(
  body: HTMLElement,
  title: "同义词" | "相似词",
  values: readonly RelatedTerm[] | null | undefined,
): void {
  if (values === null || values === undefined || values.length === 0) {
    return;
  }
  const section = createSection(body, title);
  const list = body.ownerDocument.createElement("ul");
  list.className = "huayi-term-list";
  for (const [index, term] of values.entries()) {
    const item = body.ownerDocument.createElement("li");
    item.className = "huayi-term";
    item.dataset.relatedTerm = "";
    item.dataset.huayiItem = String(index);
    item.textContent = `${term.text} · ${partOfSpeechLabels[term.partOfSpeech]} · ${term.meaningZh}`;
    list.append(item);
  }
  section.append(list);
}

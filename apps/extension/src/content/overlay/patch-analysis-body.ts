import type { AnalysisResult, PartOfSpeech, Pronunciation } from "@huayi/protocol";

import type {
  ErrorOverlayState,
  LoadingOverlayState,
  ResultOverlayState,
  StreamingOverlayState,
} from "./overlay-state.js";
import { partOfSpeechLabels } from "./render-analysis-sections.js";

export type AnalysisPanelState =
  LoadingOverlayState | StreamingOverlayState | ResultOverlayState | ErrorOverlayState;

interface TextSectionSpec {
  key: string;
  kind: "text";
  title: string;
  value: string | null | undefined;
}

interface ListSectionSpec {
  key: string;
  kind: "list";
  termList?: boolean;
  title: string;
  values: readonly string[] | null | undefined;
}

type SectionSpec = TextSectionSpec | ListSectionSpec;

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
  if (value === null || value === undefined) {
    return undefined;
  }
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

function resultSections(result: AnalysisResult): SectionSpec[] {
  switch (result.type) {
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

function previewSections(state: StreamingOverlayState | ErrorOverlayState): SectionSpec[] {
  const { sections, text: deltas } = state.preview;
  const lexical = ["word", "phrase"].includes(state.selection.selectionKind);
  if (state.action === "translate" && lexical) {
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
  if (state.action === "explain" && lexical) {
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

function markEntering(element: HTMLElement): void {
  element.classList.add("huayi-enter");
  const finish = (event: AnimationEvent): void => {
    if (event.target === element) {
      element.classList.remove("huayi-enter");
      element.removeEventListener("animationend", finish);
    }
  };
  element.addEventListener("animationend", finish);
}

function ensurePreview(body: HTMLElement): HTMLElement {
  const existing = body.querySelector<HTMLElement>(":scope > .huayi-analysis-content");
  if (existing !== null) {
    return existing;
  }
  const preview = body.ownerDocument.createElement("div");
  preview.className = "huayi-analysis-content huayi-preview";
  body.prepend(preview);
  return preview;
}

function patchSource(content: HTMLElement, value: string): HTMLElement {
  let source = content.querySelector<HTMLElement>(':scope > [data-huayi-section="source"]');
  if (source === null) {
    source = content.ownerDocument.createElement("p");
    source.className = "huayi-source";
    source.dataset.huayiSection = "source";
    source.dataset.huayiValue = "";
    content.prepend(source);
  }
  if (source.textContent !== value) {
    source.textContent = value;
  }
  return source;
}

function ensureSection(content: HTMLElement, spec: SectionSpec): HTMLElement {
  let section = content.querySelector<HTMLElement>(`:scope > [data-huayi-section="${spec.key}"]`);
  if (section !== null) {
    return section;
  }
  section = content.ownerDocument.createElement("section");
  section.className = "huayi-section";
  section.dataset.huayiSection = spec.key;
  const heading = content.ownerDocument.createElement("h3");
  heading.className = "huayi-section-title";
  heading.textContent = spec.title;
  section.append(heading);
  markEntering(section);
  return section;
}

function patchTextSection(section: HTMLElement, value: string): void {
  let copy = section.querySelector<HTMLElement>(":scope > [data-huayi-value]");
  if (copy === null) {
    copy = section.ownerDocument.createElement("p");
    copy.className = "huayi-copy";
    copy.dataset.huayiValue = "";
    section.append(copy);
  }
  if (copy.textContent !== value) {
    copy.textContent = value;
  }
}

function patchListSection(section: HTMLElement, spec: ListSectionSpec, final: boolean): void {
  let listElement = section.querySelector<HTMLElement>(":scope > ul");
  if (listElement === null) {
    listElement = section.ownerDocument.createElement("ul");
    listElement.className = spec.termList ? "huayi-term-list" : "huayi-list";
    section.append(listElement);
  }
  const values = spec.values ?? [];
  values.forEach((value, index) => {
    let item = listElement?.children.item(index) as HTMLLIElement | null;
    if (item === null) {
      item = section.ownerDocument.createElement("li");
      item.dataset.huayiItem = String(index);
      if (spec.termList === true) {
        item.className = "huayi-term";
        item.dataset.relatedTerm = "";
      }
      listElement?.append(item);
      markEntering(item);
    }
    if (item.textContent !== value) {
      item.textContent = value;
    }
  });
  if (final) {
    while (listElement.children.length > values.length) {
      listElement.lastElementChild?.remove();
    }
  }
}

function patchSections(content: HTMLElement, specs: SectionSpec[], final: boolean): void {
  const populated = specs.filter((spec) =>
    spec.kind === "text" ? (spec.value?.length ?? 0) > 0 : (spec.values?.length ?? 0) > 0,
  );
  const sectionElements = populated.map((spec) => {
    const section = ensureSection(content, spec);
    if (spec.kind === "text") {
      patchTextSection(section, spec.value ?? "");
    } else {
      patchListSection(section, spec, final);
    }
    return section;
  });
  let previous = content.querySelector<HTMLElement>(':scope > [data-huayi-section="source"]');
  sectionElements.forEach((section) => {
    const expected = previous === null ? content.firstElementChild : previous.nextElementSibling;
    if (expected !== section) {
      content.insertBefore(section, expected);
    }
    previous = section;
  });
  if (final) {
    const retained = new Set(["source", ...populated.map((spec) => spec.key)]);
    content.querySelectorAll<HTMLElement>(":scope > [data-huayi-section]").forEach((section) => {
      if (!retained.has(section.dataset.huayiSection ?? "")) {
        section.remove();
      }
    });
  }
}

function renderWaiting(container: HTMLElement, message: string): void {
  let loading = container.querySelector<HTMLElement>(":scope > .huayi-loading");
  if (loading === null) {
    loading = container.ownerDocument.createElement("div");
    loading.className = "huayi-loading";
    const spinner = container.ownerDocument.createElement("span");
    spinner.className = "huayi-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const copy = container.ownerDocument.createElement("p");
    copy.className = "huayi-copy";
    loading.append(spinner, copy);
    container.append(loading);
  }
  const copy = loading.querySelector<HTMLElement>(".huayi-copy");
  if (copy !== null && copy.textContent !== message) {
    copy.textContent = message;
  }
}

export function patchAnalysisBody(body: HTMLElement, state: AnalysisPanelState): void {
  const waitingMessage = state.action === "translate" ? "正在翻译…" : "正在解释…";
  if (state.status === "loading") {
    body.querySelector(":scope > .huayi-analysis-content")?.remove();
    renderWaiting(body, waitingMessage);
    return;
  }
  body.querySelector(":scope > .huayi-loading")?.remove();
  if (state.status === "error" && state.preview.lastSequence < 0) {
    body.querySelector(":scope > .huayi-analysis-content")?.remove();
    return;
  }
  const content = ensurePreview(body);
  content.classList.toggle("huayi-preview", state.status !== "result");
  const sourceText =
    state.status === "result" ? state.result.sourceText : state.selection.selection;
  patchSource(content, sourceText);
  if (state.status === "streaming" && state.preview.lastSequence < 0) {
    renderWaiting(content, waitingMessage);
    return;
  }
  content.querySelector(":scope > .huayi-loading")?.remove();
  patchSections(
    content,
    state.status === "result" ? resultSections(state.result) : previewSections(state),
    state.status === "result",
  );
  let incomplete = content.querySelector<HTMLElement>(":scope > .huayi-preview-incomplete");
  if (state.status === "error") {
    if (incomplete === null) {
      incomplete = content.ownerDocument.createElement("p");
      incomplete.className = "huayi-preview-incomplete";
      incomplete.textContent = "内容未完整生成";
      content.append(incomplete);
    }
  } else {
    incomplete?.remove();
  }
}

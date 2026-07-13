import type { ErrorOverlayState, StreamingOverlayState } from "./overlay-state.js";
import {
  appendCollocations,
  appendContextExample,
  appendCoreMeanings,
  appendPartOfSpeech,
  appendPronunciation,
  appendRelatedTerms,
  appendSource,
  appendTextSection,
} from "./render-analysis-sections.js";

function createWaiting(state: StreamingOverlayState | ErrorOverlayState): HTMLElement {
  const loading = document.createElement("div");
  loading.className = "huayi-loading";

  const spinner = document.createElement("span");
  spinner.className = "huayi-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const message = document.createElement("p");
  message.className = "huayi-copy";
  message.textContent = state.action === "translate" ? "正在翻译…" : "正在解释…";
  loading.append(spinner, message);
  return loading;
}

function appendAvailableSections(
  body: HTMLElement,
  state: StreamingOverlayState | ErrorOverlayState,
): void {
  const { sections, text } = state.preview;
  const isLexical =
    state.selection.selectionKind === "word" || state.selection.selectionKind === "phrase";
  if (state.action === "translate" && isLexical) {
    appendTextSection(body, "语境义", text["contextual-meaning"]);
    appendPartOfSpeech(body, sections.partOfSpeech);
    appendPronunciation(body, sections.pronunciation);
    appendCollocations(body, sections.collocations);
    appendContextExample(body, sections.contextExample);
    appendRelatedTerms(body, "相似词", sections.similarTerms);
    appendUnexpectedLexicalText(body, text);
    return;
  }
  if (state.action === "explain" && isLexical) {
    appendTextSection(body, "语境义", text["contextual-meaning"]);
    appendTextSection(body, "原形", sections.baseForm);
    appendTextSection(body, "构词", sections.wordFormation);
    appendCoreMeanings(body, sections.coreMeanings);
    appendCollocations(body, sections.collocations);
    appendRelatedTerms(body, "同义词", sections.synonyms);
    appendUnexpectedLexicalText(body, text);
    return;
  }
  if (state.action === "translate") {
    appendTextSection(body, "译文", text.translation);
    return;
  }
  appendTextSection(body, "句子主干", text["main-structure"]);
  appendTextSection(body, "句意翻译", text.translation);
  appendTextSection(body, "语境作用", text["context-role"]);
}

function appendUnexpectedLexicalText(
  body: HTMLElement,
  text: StreamingOverlayState["preview"]["text"],
): void {
  appendTextSection(body, "译文", text.translation);
  appendTextSection(body, "句子主干", text["main-structure"]);
  appendTextSection(body, "语境作用", text["context-role"]);
}

export function renderStreamingPreview(
  state: StreamingOverlayState | ErrorOverlayState,
): HTMLElement {
  const preview = document.createElement("div");
  preview.className = "huayi-preview";

  appendSource(preview, state.selection.selection);

  if (state.preview.lastSequence < 0) {
    preview.append(createWaiting(state));
  } else {
    appendAvailableSections(preview, state);
  }

  if (state.status === "error" && state.preview.lastSequence >= 0) {
    const incomplete = document.createElement("p");
    incomplete.className = "huayi-preview-incomplete";
    incomplete.textContent = "内容未完整生成";
    preview.append(incomplete);
  }

  return preview;
}

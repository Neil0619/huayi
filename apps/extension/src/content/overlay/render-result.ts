import type { AnalysisResult, Collocation, PartOfSpeech, RelatedTerm } from "@huayi/protocol";

import type {
  ErrorOverlayState,
  LoadingOverlayState,
  ResultOverlayState,
  StreamingOverlayState,
} from "./overlay-state.js";
import { renderStreamingPreview } from "./render-streaming-preview.js";
import { renderWordbookAction, renderWordbookError } from "./render-wordbook-action.js";

export interface PanelHandlers {
  onAddWord: () => void;
  onClose: () => void;
  onRetry: () => void;
}

type PanelState =
  LoadingOverlayState | StreamingOverlayState | ResultOverlayState | ErrorOverlayState;

const partOfSpeechLabels: Record<PartOfSpeech, string> = {
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

function createSection(title: string, value?: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "huayi-section";

  const heading = document.createElement("h3");
  heading.className = "huayi-section-title";
  heading.textContent = title;
  section.append(heading);

  if (value !== undefined) {
    const copy = document.createElement("p");
    copy.className = "huayi-copy";
    copy.textContent = value;
    section.append(copy);
  }

  return section;
}

function appendSource(body: HTMLElement, sourceText: string): void {
  const source = document.createElement("p");
  source.className = "huayi-source";
  source.textContent = sourceText;
  body.append(source);
}

function appendStringList(section: HTMLElement, values: string[]): void {
  const list = document.createElement("ul");
  list.className = "huayi-list";

  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }

  section.append(list);
}

function appendCollocations(body: HTMLElement, collocations: Collocation[]): void {
  const section = createSection("语境搭配");
  appendStringList(
    section,
    collocations.map((item) => `${item.text}（${item.meaningZh}）`),
  );
  body.append(section);
}

function appendRelatedTerms(body: HTMLElement, title: string, terms: RelatedTerm[]): void {
  const section = createSection(title);
  const list = document.createElement("ul");
  list.className = "huayi-term-list";

  for (const term of terms) {
    const item = document.createElement("li");
    item.className = "huayi-term";
    item.dataset.relatedTerm = "";
    item.textContent = `${term.text} · ${partOfSpeechLabels[term.partOfSpeech]} · ${term.meaningZh}`;
    list.append(item);
  }

  section.append(list);
  body.append(section);
}

function renderLexicalTranslation(
  body: HTMLElement,
  result: Extract<AnalysisResult, { type: "translate-lexical" }>,
): void {
  appendSource(body, result.sourceText);
  body.append(createSection("语境义", result.contextualMeaningZh));
  body.append(createSection("词性", partOfSpeechLabels[result.partOfSpeech]));

  if (result.pronunciation !== undefined) {
    const pronunciations = [
      result.pronunciation.uk === undefined ? undefined : `英 ${result.pronunciation.uk}`,
      result.pronunciation.us === undefined ? undefined : `美 ${result.pronunciation.us}`,
    ].filter((value): value is string => value !== undefined);
    body.append(createSection("音标", pronunciations.join("　")));
  }

  appendCollocations(body, result.collocations);

  if (result.contextExample !== undefined) {
    body.append(
      createSection(
        "原文例句",
        `${result.contextExample.english}\n${result.contextExample.translationZh}`,
      ),
    );
  }

  appendRelatedTerms(body, "相似词", result.similarTerms);
}

function renderPassageTranslation(
  body: HTMLElement,
  result: Extract<AnalysisResult, { type: "translate-passage" }>,
): void {
  appendSource(body, result.sourceText);
  body.append(createSection("译文", result.translationZh));
}

function renderLexicalExplanation(
  body: HTMLElement,
  result: Extract<AnalysisResult, { type: "explain-lexical" }>,
): void {
  appendSource(body, result.sourceText);
  body.append(createSection("语境义", result.contextualMeaningZh));

  if (result.baseForm !== undefined) {
    body.append(createSection("原形", result.baseForm));
  }
  if (result.wordFormation !== undefined) {
    body.append(createSection("构词", result.wordFormation));
  }

  const meanings = createSection("核心词义");
  appendStringList(
    meanings,
    result.coreMeanings.map(
      (meaning) => `${partOfSpeechLabels[meaning.partOfSpeech]} ${meaning.meaningZh}`,
    ),
  );
  body.append(meanings);
  appendCollocations(body, result.collocations);
  appendRelatedTerms(body, "同义词", result.synonyms);
}

function renderSentenceExplanation(
  body: HTMLElement,
  result: Extract<AnalysisResult, { type: "explain-sentence" }>,
): void {
  appendSource(body, result.sourceText);
  body.append(createSection("句子主干", result.mainStructure));

  const expressions = createSection("关键表达");
  appendStringList(
    expressions,
    result.keyExpressions.map((expression) => `${expression.text}：${expression.meaningZh}`),
  );
  body.append(expressions);
  body.append(createSection("句意翻译", result.translationZh));
  body.append(createSection("语境作用", result.contextRole));
}

function renderResultBody(body: HTMLElement, result: AnalysisResult): void {
  switch (result.type) {
    case "translate-lexical":
      renderLexicalTranslation(body, result);
      break;
    case "translate-passage":
      renderPassageTranslation(body, result);
      break;
    case "explain-lexical":
      renderLexicalExplanation(body, result);
      break;
    case "explain-sentence":
      renderSentenceExplanation(body, result);
      break;
  }
}

function createHeader(state: PanelState, handlers: PanelHandlers): HTMLElement {
  const header = document.createElement("header");
  header.className = "huayi-header";

  const title = document.createElement("h2");
  title.className = "huayi-title";
  title.textContent = state.action === "translate" ? "翻译" : "解释";

  const dragHandle = document.createElement("button");
  dragHandle.className = "huayi-drag-handle";
  dragHandle.dataset.dragHandle = "";
  dragHandle.setAttribute("aria-label", "拖动浮层");
  dragHandle.type = "button";

  const close = document.createElement("button");
  close.className = "huayi-close";
  close.dataset.action = "close";
  close.setAttribute("aria-label", "关闭划译浮层");
  close.textContent = "×";
  close.type = "button";
  close.addEventListener("click", handlers.onClose);

  const actions = document.createElement("div");
  actions.className = "huayi-header-actions";
  const wordbook = renderWordbookAction(state, handlers.onAddWord);
  if (wordbook !== null) {
    actions.append(wordbook);
  }
  actions.append(close);

  header.append(title, dragHandle, actions);
  return header;
}

function renderAnalysisError(
  state: ErrorOverlayState,
  compact: boolean,
  onRetry: () => void,
): HTMLElement {
  const error = document.createElement("div");
  error.className = compact ? "huayi-error huayi-error-inline" : "huayi-error";

  const message = document.createElement("p");
  message.className = "huayi-copy";
  message.textContent = state.error.message;
  error.append(message);

  if (state.error.retryable) {
    const retry = document.createElement("button");
    retry.className = "huayi-retry";
    retry.dataset.action = "retry";
    retry.textContent = "重试";
    retry.type = "button";
    retry.addEventListener("click", onRetry);
    error.append(retry);
  }
  return error;
}

export function renderOverlayPanel(
  state: PanelState,
  handlers: PanelHandlers,
  now = Date.now(),
): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "huayi-root huayi-panel";
  panel.setAttribute("aria-live", "polite");
  panel.append(createHeader(state, handlers));
  const wordbookError = renderWordbookError(state);
  if (wordbookError !== null) {
    panel.append(wordbookError);
  }

  const body = document.createElement("div");
  body.className = "huayi-body";

  if (state.status === "loading") {
    const loading = document.createElement("div");
    loading.className = "huayi-loading";
    const spinner = document.createElement("span");
    spinner.className = "huayi-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const message = document.createElement("p");
    message.className = "huayi-copy";
    message.textContent = state.action === "translate" ? "正在翻译…" : "正在解释…";
    loading.append(spinner, message);

    if (now - state.startedAt >= 8_000) {
      const hint = document.createElement("p");
      hint.className = "huayi-slow-hint";
      hint.textContent = "仍在处理，请稍候…";
      loading.append(hint);
    }
    body.append(loading);
  } else if (state.status === "streaming") {
    body.append(renderStreamingPreview(state));
  } else if (state.status === "error") {
    const hasPreview = state.preview.lastSequence >= 0;
    if (hasPreview) {
      body.append(renderStreamingPreview(state));
    }
    body.append(renderAnalysisError(state, hasPreview, handlers.onRetry));
  } else {
    renderResultBody(body, state.result);
  }

  panel.append(body);
  return panel;
}

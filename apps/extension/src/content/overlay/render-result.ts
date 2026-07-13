import type { AnalysisResult } from "@huayi/protocol";

import type {
  ErrorOverlayState,
  LoadingOverlayState,
  ResultOverlayState,
  StreamingOverlayState,
} from "./overlay-state.js";
import {
  appendCollocations,
  appendContextExample,
  appendCoreMeanings,
  appendPartOfSpeech,
  appendPronunciation,
  appendRelatedTerms,
  appendSource,
  appendStringListSection,
  appendTextSection,
} from "./render-analysis-sections.js";
import { renderStreamingPreview } from "./render-streaming-preview.js";
import { renderWordbookAction, renderWordbookError } from "./render-wordbook-action.js";

export interface PanelHandlers {
  onAddWord: () => void;
  onClose: () => void;
  onRetry: () => void;
}

type PanelState =
  LoadingOverlayState | StreamingOverlayState | ResultOverlayState | ErrorOverlayState;

function renderLexicalTranslation(
  body: HTMLElement,
  result: Extract<AnalysisResult, { type: "translate-lexical" }>,
): void {
  appendSource(body, result.sourceText);
  appendTextSection(body, "语境义", result.contextualMeaningZh);
  appendPartOfSpeech(body, result.partOfSpeech);
  appendPronunciation(body, result.pronunciation);
  appendCollocations(body, result.collocations);
  appendContextExample(body, result.contextExample);
  appendRelatedTerms(body, "相似词", result.similarTerms);
}

function renderPassageTranslation(
  body: HTMLElement,
  result: Extract<AnalysisResult, { type: "translate-passage" }>,
): void {
  appendSource(body, result.sourceText);
  appendTextSection(body, "译文", result.translationZh);
}

function renderLexicalExplanation(
  body: HTMLElement,
  result: Extract<AnalysisResult, { type: "explain-lexical" }>,
): void {
  appendSource(body, result.sourceText);
  appendTextSection(body, "语境义", result.contextualMeaningZh);
  appendTextSection(body, "原形", result.baseForm);
  appendTextSection(body, "构词", result.wordFormation);
  appendCoreMeanings(body, result.coreMeanings);
  appendCollocations(body, result.collocations);
  appendRelatedTerms(body, "同义词", result.synonyms);
}

function renderSentenceExplanation(
  body: HTMLElement,
  result: Extract<AnalysisResult, { type: "explain-sentence" }>,
): void {
  appendSource(body, result.sourceText);
  appendTextSection(body, "句子主干", result.mainStructure);
  appendStringListSection(
    body,
    "关键表达",
    result.keyExpressions.map((expression) => `${expression.text}：${expression.meaningZh}`),
  );
  appendTextSection(body, "句意翻译", result.translationZh);
  appendTextSection(body, "语境作用", result.contextRole);
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

import type {
  ErrorOverlayState,
  LoadingOverlayState,
  ResultOverlayState,
  StreamingOverlayState,
} from "./overlay-state.js";
import { patchAnalysisBody } from "./patch-analysis-body.js";
import { renderWordbookAction, renderWordbookError } from "./render-wordbook-action.js";

export interface PanelHandlers {
  onAddWord: () => void;
  onClose: () => void;
  onRetry: () => void;
}

export type PanelState =
  LoadingOverlayState | StreamingOverlayState | ResultOverlayState | ErrorOverlayState;

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

function patchWordbookAction(panel: HTMLElement, state: PanelState, onAddWord: () => void): void {
  const actions = panel.querySelector<HTMLElement>(".huayi-header-actions");
  const close = actions?.querySelector<HTMLElement>("[data-action='close']") ?? null;
  const current = actions?.querySelector<HTMLElement>(":scope > .huayi-wordbook") ?? null;
  const desired = renderWordbookAction(state, onAddWord);
  if (desired === null) {
    current?.remove();
    return;
  }
  if (current === null) {
    actions?.insertBefore(desired, close);
    return;
  }
  const currentButton = current.querySelector<HTMLButtonElement>("[data-action='add-word']");
  const desiredButton = desired.querySelector<HTMLButtonElement>("[data-action='add-word']");
  if (currentButton !== null && desiredButton !== null) {
    currentButton.disabled = desiredButton.disabled;
    if (currentButton.textContent !== desiredButton.textContent) {
      currentButton.textContent = desiredButton.textContent;
    }
  }
}

function patchWordbookError(panel: HTMLElement, state: PanelState): void {
  const current = panel.querySelector<HTMLElement>(":scope > .huayi-wordbook-error");
  const desired = renderWordbookError(state);
  if (desired === null) {
    current?.remove();
    return;
  }
  if (current === null) {
    panel.querySelector(":scope > .huayi-header")?.after(desired);
    return;
  }
  if (current.textContent !== desired.textContent) {
    current.textContent = desired.textContent;
  }
}

function patchAnalysisError(body: HTMLElement, state: PanelState, onRetry: () => void): void {
  const current = body.querySelector<HTMLElement>(":scope > .huayi-error");
  if (state.status !== "error") {
    current?.remove();
    return;
  }
  const hasPreview = state.preview.lastSequence >= 0;
  const desired = renderAnalysisError(state, hasPreview, onRetry);
  if (current === null) {
    body.append(desired);
    return;
  }
  current.className = desired.className;
  const currentMessage = current.querySelector<HTMLElement>(".huayi-copy");
  if (currentMessage !== null && currentMessage.textContent !== state.error.message) {
    currentMessage.textContent = state.error.message;
  }
  const currentRetry = current.querySelector<HTMLElement>("[data-action='retry']");
  const desiredRetry = desired.querySelector<HTMLElement>("[data-action='retry']");
  if (desiredRetry === null) {
    currentRetry?.remove();
  } else if (currentRetry === null) {
    current.append(desiredRetry);
  }
}

function patchSlowHint(body: HTMLElement, state: PanelState, now: number): void {
  const loading = body.querySelector<HTMLElement>(".huayi-loading");
  const current = loading?.querySelector<HTMLElement>(":scope > .huayi-slow-hint") ?? null;
  if (state.status !== "loading" || now - state.startedAt < 8_000) {
    current?.remove();
    return;
  }
  if (current === null && loading !== null) {
    const hint = body.ownerDocument.createElement("p");
    hint.className = "huayi-slow-hint";
    hint.textContent = "仍在处理，请稍候…";
    loading.append(hint);
  }
}

export function patchOverlayPanel(
  panel: HTMLElement,
  state: PanelState,
  handlers: PanelHandlers,
  now = Date.now(),
): void {
  patchWordbookAction(panel, state, handlers.onAddWord);
  patchWordbookError(panel, state);
  const body = panel.querySelector<HTMLElement>(":scope > .huayi-body");
  if (body === null) {
    return;
  }
  patchAnalysisBody(body, state);
  patchAnalysisError(body, state, handlers.onRetry);
  patchSlowHint(body, state, now);
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
  panel.append(body);
  patchOverlayPanel(panel, state, handlers, now);
  return panel;
}

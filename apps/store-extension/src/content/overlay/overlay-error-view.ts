import type { StoreAnalysisErrorCode } from "@huayi/store-domain";

import { overlayErrorPresentation } from "./overlay-errors.js";

export interface OverlayErrorViewOptions {
  readonly acceptsUserGesture: (event: Event) => boolean;
  readonly body: HTMLElement;
  readonly code: StoreAnalysisErrorCode;
  readonly onOpenOptions: () => Promise<void>;
  readonly onOpenOptionsError: () => void;
  readonly preservePreview?: boolean;
  readonly onRetry: (() => void) | null;
}

const DISCONNECTED = "disconnected";

function button(document: Document, label: string, primary = false): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = primary ? "primary" : "";
  control.textContent = label;
  return control;
}

function errorMessage(body: HTMLElement, message: string): HTMLParagraphElement {
  const copy = body.ownerDocument.createElement("p");
  copy.className = "error";
  copy.setAttribute("role", "alert");
  copy.textContent = message;
  return copy;
}

export function renderOverlayError(options: OverlayErrorViewOptions): void {
  renderErrorView(options);
}

function renderErrorView(
  options: Omit<OverlayErrorViewOptions, "code"> & {
    readonly code: StoreAnalysisErrorCode | typeof DISCONNECTED;
  },
): void {
  const presentation =
    options.code === DISCONNECTED
      ? { message: "分析连接已中断，请手动重试。", optionsAction: false, retry: true }
      : overlayErrorPresentation(options.code);
  const actions = options.body.ownerDocument.createElement("div");
  actions.className = "error-actions";
  if (presentation.optionsAction) {
    const open = button(options.body.ownerDocument, "打开设置");
    open.dataset.openOptions = "";
    open.addEventListener("click", (event) => {
      if (!options.acceptsUserGesture(event)) return;
      void options.onOpenOptions().catch(options.onOpenOptionsError);
    });
    actions.append(open);
  }
  if (presentation.retry && options.onRetry !== null) {
    const retry = button(options.body.ownerDocument, "重试", true);
    retry.dataset.retry = "";
    retry.addEventListener("click", (event) => {
      if (options.acceptsUserGesture(event)) options.onRetry?.();
    });
    actions.append(retry);
  }
  const message = errorMessage(options.body, presentation.message);
  if (options.preservePreview === true) {
    const incomplete = options.body.ownerDocument.createElement("p");
    incomplete.className = "preview-incomplete";
    incomplete.textContent = "内容未完整生成";
    options.body.append(incomplete, message, actions);
  } else {
    options.body.replaceChildren(message, actions);
  }
}

export function renderDisconnectedError(
  body: HTMLElement,
  acceptsUserGesture: (event: Event) => boolean,
  onRetry: () => void,
  preservePreview = false,
): void {
  renderErrorView({
    acceptsUserGesture,
    body,
    code: DISCONNECTED,
    onOpenOptions: async () => undefined,
    onOpenOptionsError: () => undefined,
    onRetry,
    preservePreview,
  });
}

import {
  STORE_MESSAGE_VERSION,
  type AnalysisAction,
  type AnalysisResult,
  type AnalysisUpdate,
  type StoreDefaultAction,
  type StoreAnalysisErrorCode,
  type StoreOverlayTheme,
} from "@huayi/store-domain";

import type { StoreSelectionReading } from "../selection/read-selection.js";
import { parseContentAnalysisMessage } from "../content-analysis-parser.js";
import { MAX_PREVIEW_CHARACTERS, resultMatchesAction } from "./overlay-analysis-guards.js";
import { renderDisconnectedError, renderOverlayError } from "./overlay-error-view.js";
import { OverlayCardSession, type OverlayModeState } from "./overlay-card-session.js";
import { attachOverlayStyles } from "./overlay-stylesheet.js";
import { renderCachedResult } from "./render-cached-result.js";
import { renderStreamPreview, renderStreamStatus } from "./render-stream-preview.js";
import { OverlayWordPresence } from "./overlay-word-presence.js";
import { OverlayStudyCapture } from "./overlay-study-capture.js";
import { createOverlayPanel } from "./overlay-panel.js";
import type {
  ContentAnalysisPort,
  StoreOverlayAnchor,
  StoreOverlayCloseReason,
  StoreOverlayRuntime,
} from "./overlay-runtime.js";
export type {
  ContentAnalysisPort,
  StoreOverlayAnchor,
  StoreOverlayCloseReason,
  StoreOverlayRuntime,
} from "./overlay-runtime.js";
export class StoreOverlayController {
  private activePort: ContentAnalysisPort | null = null;
  private analysisBody: HTMLElement | null = null;
  private cardSession: OverlayCardSession | null = null;
  private defaultAction: StoreDefaultAction = "ask";
  private host: HTMLElement | null = null;
  private headerActions: HTMLElement | null = null;
  private lastSequence = -1;
  private onDismiss: (() => void) | null = null;
  private previousFocus: HTMLElement | null = null;
  private readonly wordPresence: OverlayWordPresence;
  private readonly studyCapture: OverlayStudyCapture;
  private readonly preview = new Map<
    Extract<AnalysisUpdate, { type: "delta" }>["section"],
    string
  >();
  private readonly previewSections = new Map<
    Extract<AnalysisUpdate, { type: "section" }>["section"],
    Extract<AnalysisUpdate, { type: "section" }>
  >();
  private promoteToResult: (() => void) | null = null;
  private remoteRequestId: string | null = null;
  private selection: StoreSelectionReading | null = null;
  private theme: StoreOverlayTheme = "pearl";

  constructor(
    private readonly document: Document,
    private readonly runtime: StoreOverlayRuntime,
    private readonly acceptsUserGesture: (event: Event) => boolean = (event) => event.isTrusted,
  ) {
    this.wordPresence = new OverlayWordPresence(runtime);
    this.studyCapture = new OverlayStudyCapture({
      acceptsUserGesture: this.acceptsUserGesture,
      send: (request) => runtime.studyCapture(request),
    });
  }

  show(selection: StoreSelectionReading, anchor: StoreOverlayAnchor, onDismiss?: () => void): void {
    this.removeOverlay("replacement");
    this.selection = selection;
    this.studyCapture.reset();
    this.cardSession = new OverlayCardSession();
    this.onDismiss = onDismiss ?? null;
    this.previousFocus =
      this.document.activeElement instanceof HTMLElement ? this.document.activeElement : null;

    const host = this.document.createElement("div");
    host.dataset.huayiStoreOverlay = "";
    host.style.position = "fixed";
    host.style.zIndex = "2147483647";
    host.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - 32))}px`;
    host.style.top = `${Math.max(8, Math.min(anchor.bottom + 8, window.innerHeight - 32))}px`;
    const shadow = host.attachShadow({ mode: "open" });
    const view = createOverlayPanel(this.document, this.theme, (action, event) => {
      if (this.acceptsUserGesture(event)) this.start(action);
    });
    this.analysisBody = view.body;
    this.headerActions = view.headerActions;
    this.promoteToResult = view.promoteToResult;
    attachOverlayStyles(this.document, shadow, view.panel, this.runtime.overlayStylesheetUrl());
    (this.document.body ?? this.document.documentElement).append(host);
    this.host = host;
    shadow.querySelector<HTMLButtonElement>("[data-action]")?.focus();
    this.document.addEventListener("keydown", this.onDocumentKeyDown, true);
    this.document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
    if (this.defaultAction !== "ask") this.start(this.defaultAction);
  }

  setDefaultAction(action: StoreDefaultAction): void {
    this.defaultAction = action;
  }

  setTheme(theme: StoreOverlayTheme): void {
    this.theme = theme;
    const panel = this.host?.shadowRoot?.querySelector<HTMLElement>(".panel");
    if (panel !== null && panel !== undefined) panel.dataset.theme = theme;
  }

  close(reason: StoreOverlayCloseReason = "dismissed"): void {
    this.removeOverlay(reason);
  }

  private start(action: AnalysisAction): void {
    if (this.selection === null || this.host === null || this.cardSession === null) return;
    const activation = this.cardSession.activate(action);
    if (activation.cancelled !== null) this.stopPort(true);
    this.promoteToResult?.();
    this.setModeControls(action, activation.state.status === "loading");
    if (!activation.shouldStart) {
      this.renderModeState(action, activation.state);
      return;
    }
    this.stopPort(true);
    this.lastSequence = -1;
    this.preview.clear();
    this.previewSections.clear();
    this.remoteRequestId = null;
    if (
      this.selection.selectionKind === "word" &&
      this.headerActions !== null &&
      this.headerActions.querySelector(".lexicon-save") === null
    ) {
      this.wordPresence.query(this.selection.selection, this.headerActions);
    }
    this.renderStatus();
    this.studyCapture.startAutomatic(this.selection);

    let port: ContentAnalysisPort;
    try {
      port = this.runtime.connectAnalysis();
      this.activePort = port;
      port.onMessage.addListener((message) => this.receive(port, action, message));
      port.onDisconnect.addListener(() => this.disconnected(port, action));
      port.postMessage({
        action,
        boundaryEvidence: this.selection.boundaryEvidence,
        messageVersion: STORE_MESSAGE_VERSION,
        selection: this.selection.selection,
        sentenceContext: this.selection.sentenceContext,
        type: "store/analysis-start",
      });
    } catch {
      this.activePort = null;
      this.finishWithError(action, "internal-error");
    }
  }

  private receive(port: ContentAnalysisPort, action: AnalysisAction, value: unknown): void {
    if (port !== this.activePort || this.cardSession?.currentAction() !== action) return;
    let message;
    try {
      message = parseContentAnalysisMessage(value);
    } catch {
      this.finishWithError(action, "invalid-response");
      return;
    }
    if (message.type === "store/analysis-error") {
      if (
        message.requestId !== null &&
        this.remoteRequestId !== null &&
        message.requestId !== this.remoteRequestId
      ) {
        this.finishWithError(action, "invalid-response");
        return;
      }
      this.finishWithError(action, message.code);
      return;
    }
    if (message.type === "store/analysis-update") {
      const { update } = message;
      if (this.remoteRequestId !== null && update.requestId !== this.remoteRequestId) {
        this.finishWithError(action, "invalid-response");
        return;
      }
      this.remoteRequestId = update.requestId;
      if (update.type === "progress") {
        this.renderStatus();
        return;
      }
      if (update.sequence <= this.lastSequence) {
        this.finishWithError(action, "invalid-response");
        return;
      }
      this.lastSequence = update.sequence;
      if (update.type === "delta") {
        const current = this.preview.get(update.section) ?? "";
        const total = Array.from(this.preview.values()).reduce((sum, text) => sum + text.length, 0);
        if (total + update.text.length > MAX_PREVIEW_CHARACTERS) {
          this.finishWithError(action, "invalid-response");
          return;
        }
        this.preview.set(update.section, current + update.text);
      } else {
        this.previewSections.set(update.section, update);
      }
      this.renderPreview();
      return;
    }
    if (
      this.selection === null ||
      message.result.sourceText !== this.selection.selection ||
      message.result.selectionKind !== this.selection.selectionKind ||
      !resultMatchesAction(message.result.type, action) ||
      (this.remoteRequestId !== null && message.result.requestId !== this.remoteRequestId)
    ) {
      this.finishWithError(action, "invalid-response");
      return;
    }
    this.remoteRequestId = message.result.requestId;
    this.stopPort(false);
    this.cardSession?.complete(action, message.result);
    this.setModeControls(action, false);
    this.renderReady(message.result);
  }

  private renderPreview(): void {
    if (this.analysisBody === null) return;
    delete this.analysisBody.dataset.resultType;
    renderStreamPreview(this.analysisBody, this.preview, this.previewSections);
  }

  private renderStatus(): void {
    if (this.analysisBody === null) return;
    delete this.analysisBody.dataset.resultType;
    renderStreamStatus(this.analysisBody);
  }

  private renderModeState(action: AnalysisAction, state: OverlayModeState): void {
    if (state.status === "ready") {
      this.renderReady(state.result);
      return;
    }
    if (state.status === "error") {
      this.renderError(action, state.code);
      return;
    }
    if (state.status === "disconnected" && this.analysisBody !== null) {
      delete this.analysisBody.dataset.resultType;
      renderDisconnectedError(
        this.analysisBody,
        this.acceptsUserGesture,
        () => {
          this.cardSession?.retry(action);
          this.start(action);
        },
        this.preview.size > 0 || this.previewSections.size > 0,
      );
      return;
    }
    this.renderStatus();
  }

  private renderReady(result: AnalysisResult): void {
    if (this.analysisBody === null || this.selection === null) return;
    if (this.headerActions === null) return;
    renderCachedResult({
      acceptsUserGesture: this.acceptsUserGesture,
      body: this.analysisBody,
      headerActions: this.headerActions,
      presence: this.wordPresence,
      openWebWorkspace: () => this.runtime.openWebWorkspace(),
      result,
      saveWord: (request) => this.runtime.saveWord(request),
      sentence: this.selection.sentenceContext ?? this.selection.selection,
    });
    this.studyCapture.render(this.analysisBody, this.selection);
  }

  private finishWithError(action: AnalysisAction, code: StoreAnalysisErrorCode): void {
    this.stopPort(false);
    this.cardSession?.fail(action, code);
    this.setModeControls(action, false);
    this.renderError(action, code);
  }

  private renderError(action: AnalysisAction, code: StoreAnalysisErrorCode): void {
    if (this.analysisBody === null) return;
    delete this.analysisBody.dataset.resultType;
    renderOverlayError({
      acceptsUserGesture: this.acceptsUserGesture,
      body: this.analysisBody,
      code,
      onOpenOptions: () => this.runtime.openOptions(),
      onOpenOptionsError: () => {
        this.cardSession?.fail(action, "internal-error");
        this.renderError(action, "internal-error");
      },
      preservePreview: this.preview.size > 0 || this.previewSections.size > 0,
      onRetry: () => {
        this.cardSession?.retry(action);
        this.start(action);
      },
    });
    if (this.selection !== null) this.studyCapture.render(this.analysisBody, this.selection);
  }

  private disconnected(port: ContentAnalysisPort, action: AnalysisAction): void {
    if (port !== this.activePort) return;
    this.activePort = null;
    this.cardSession?.disconnect(action);
    this.setModeControls(action, false);
    if (this.analysisBody === null) return;
    delete this.analysisBody.dataset.resultType;
    renderDisconnectedError(
      this.analysisBody,
      this.acceptsUserGesture,
      () => {
        this.cardSession?.retry(action);
        this.start(action);
      },
      this.preview.size > 0 || this.previewSections.size > 0,
    );
  }

  private setModeControls(action: AnalysisAction, loading: boolean): void {
    for (const button of this.host?.shadowRoot?.querySelectorAll<HTMLButtonElement>(
      "[data-action]",
    ) ?? []) {
      const active = button.dataset.action === action;
      button.disabled = loading && active;
      button.dataset.active = String(active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  private stopPort(cancel: boolean): void {
    const port = this.activePort;
    if (port === null) return;
    this.activePort = null;
    if (cancel) {
      try {
        port.postMessage({ messageVersion: STORE_MESSAGE_VERSION, type: "store/analysis-cancel" });
      } catch {
        // Disconnect still gives the Service Worker a cancellation signal.
      }
    }
    try {
      port.disconnect();
    } catch {
      // The port is already disconnected.
    }
  }

  private removeOverlay(reason: StoreOverlayCloseReason | "replacement"): void {
    const hadOverlay = this.host !== null;
    const onDismiss = this.onDismiss;
    this.stopPort(true);
    this.document.removeEventListener("keydown", this.onDocumentKeyDown, true);
    this.document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
    this.host?.remove();
    this.host = null;
    this.analysisBody = null;
    this.cardSession = null;
    this.headerActions = null;
    this.promoteToResult = null;
    this.selection = null;
    this.onDismiss = null;
    this.wordPresence.reset();
    this.studyCapture.reset();
    if (reason !== "replacement" && this.previousFocus?.isConnected === true) {
      this.previousFocus.focus();
    }
    this.previousFocus = null;
    if (hadOverlay && reason !== "replacement") this.document.getSelection()?.removeAllRanges();
    if (hadOverlay && reason === "dismissed") onDismiss?.();
  }

  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.host === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (
      this.host === null ||
      event.composedPath().includes(this.host) ||
      !this.acceptsUserGesture(event)
    ) {
      return;
    }
    this.close();
  };
}

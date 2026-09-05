import {
  STORE_MESSAGE_VERSION,
  type AnalysisAction,
  type AnalysisResult,
  type AnalysisUpdate,
  type StoreAppearance,
  type StoreDefaultAction,
  type StoreAnalysisErrorCode,
  type StoreOverlayTheme,
} from "@huayi/store-domain";

import type { StoreSelectionReading } from "../selection/read-selection.js";
import { parseContentAnalysisMessage } from "../content-analysis-parser.js";
import { MAX_PREVIEW_CHARACTERS, resultMatchesAction } from "./overlay-analysis-guards.js";
import { renderDisconnectedError, renderOverlayError } from "./overlay-error-view.js";
import { OverlayCardSession, type OverlayModeState } from "./overlay-card-session.js";
import { OverlayInteractionLifecycle } from "./overlay-interaction-lifecycle.js";
import { attachOverlayStyles } from "./overlay-stylesheet.js";
import { renderCachedResult } from "./render-cached-result.js";
import { renderStreamPreview, renderStreamStatus } from "./render-stream-preview.js";
import { OverlayWordPresence } from "./overlay-word-presence.js";
import { OverlayStudyCapture } from "./overlay-study-capture.js";
import { createOverlayPanel } from "./overlay-panel.js";
import {
  disconnectAnalysisPort,
  requestAnalysisStop,
  measureQueryPresentation,
  showQueryDiagnostic,
  restoreQueryFocus,
} from "./overlay-runtime.js";
import {
  applyOverlayAppearance,
  applyOverlayTheme,
  createOverlayHost,
  updateOverlayModeControls,
} from "./overlay-visual-state.js";
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
  #activePort: ContentAnalysisPort | null = null;
  #appearance: StoreAppearance = "silver";
  #analysisBody: HTMLElement | null = null;
  #footer: HTMLElement | null = null;
  #cardSession: OverlayCardSession | null = null;
  #defaultAction: StoreDefaultAction = "ask";
  #host: HTMLElement | null = null;
  #headerActions: HTMLElement | null = null;
  #lastSequence = -1;
  #onDismiss: (() => void) | null = null;
  #previousFocus: HTMLElement | null = null;
  readonly #interaction: OverlayInteractionLifecycle;
  readonly #wordPresence: OverlayWordPresence;
  readonly #studyCapture: OverlayStudyCapture;
  readonly #preview = new Map<Extract<AnalysisUpdate, { type: "delta" }>["section"], string>();
  readonly #previewSections = new Map<
    Extract<AnalysisUpdate, { type: "section" }>["section"],
    Extract<AnalysisUpdate, { type: "section" }>
  >();
  #promoteToResult: (() => void) | null = null;
  #remoteRequestId: string | null = null;
  #selection: StoreSelectionReading | null = null;
  #theme: StoreOverlayTheme = "pearl";
  readonly #document: Document;
  readonly #runtime: StoreOverlayRuntime;
  readonly #acceptsUserGesture: (event: Event) => boolean;

  constructor(
    document: Document,
    runtime: StoreOverlayRuntime,
    acceptsUserGesture: (event: Event) => boolean = (event) => event.isTrusted,
  ) {
    this.#document = document;
    this.#runtime = runtime;
    this.#acceptsUserGesture = acceptsUserGesture;
    this.#interaction = new OverlayInteractionLifecycle(document, this.#acceptsUserGesture, () =>
      this.close(),
    );
    this.#wordPresence = new OverlayWordPresence(runtime);
    this.#studyCapture = new OverlayStudyCapture({
      acceptsUserGesture: this.#acceptsUserGesture,
      send: (request) => runtime.studyCapture(request),
    });
  }

  show(selection: StoreSelectionReading, anchor: StoreOverlayAnchor, onDismiss?: () => void): void {
    this.#removeOverlay("replacement");
    this.#selection = selection;
    this.#studyCapture.reset();
    this.#cardSession = new OverlayCardSession();
    this.#onDismiss = onDismiss ?? null;
    this.#previousFocus =
      this.#document.activeElement instanceof HTMLElement ? this.#document.activeElement : null;

    const { host, shadow } = createOverlayHost(this.#document, anchor);
    const view = createOverlayPanel(
      this.#document,
      this.#theme,
      (action, event) => {
        if (this.#acceptsUserGesture(event)) this.#start(action);
      },
      () => this.close(),
      () => requestAnalysisStop(this.#activePort, this.#analysisBody),
    );
    applyOverlayAppearance(host, this.#appearance, view.panel);
    this.#analysisBody = view.body;
    this.#footer = view.footer;
    this.#headerActions = view.headerActions;
    this.#promoteToResult = view.promoteToResult;
    attachOverlayStyles(
      this.#document,
      shadow,
      view.panel,
      this.#runtime.overlayStylesheetUrl(),
      () => this.#interaction.position(),
    );
    (this.#document.body ?? this.#document.documentElement).append(host);
    this.#host = host;
    this.#interaction.start(host, anchor, selection.range);
    if (this.#defaultAction !== "ask") this.#start(this.#defaultAction);
  }

  setDefaultAction(action: StoreDefaultAction): void {
    this.#defaultAction = action;
  }

  setAppearance(appearance: StoreAppearance): void {
    this.#appearance = appearance;
    applyOverlayAppearance(this.#host, appearance);
  }

  setTheme(theme: StoreOverlayTheme): void {
    this.#theme = theme;
    applyOverlayTheme(this.#host, theme);
  }

  close(reason: StoreOverlayCloseReason = "dismissed"): void {
    this.#removeOverlay(reason);
  }

  #start(action: AnalysisAction): void {
    if (this.#selection === null || this.#host === null || this.#cardSession === null) return;
    const activation = this.#cardSession.activate(action);
    if (activation.cancelled !== null) this.#stopPort(false);
    this.#promoteToResult?.();
    this.#interaction.position();
    updateOverlayModeControls(this.#host, action, activation.state.status === "loading");
    if (!activation.shouldStart) {
      this.#renderModeState(action, activation.state);
      return;
    }
    this.#stopPort(false);
    this.#lastSequence = -1;
    this.#preview.clear();
    this.#previewSections.clear();
    this.#remoteRequestId = null;
    if (
      this.#selection.selectionKind === "word" &&
      this.#headerActions !== null &&
      this.#headerActions.querySelector(".lexicon-save") === null
    ) {
      this.#wordPresence.query(this.#selection.selection, this.#headerActions);
    }
    this.#renderStatus();
    this.#studyCapture.startAutomatic(this.#selection);

    let port: ContentAnalysisPort;
    try {
      port = this.#runtime.connectAnalysis();
      this.#activePort = port;
      port.onMessage.addListener((message) => this.#receive(port, action, message));
      port.onDisconnect.addListener(() => this.#disconnected(port, action));
      port.postMessage({
        action,
        boundaryEvidence: this.#selection.boundaryEvidence,
        messageVersion: STORE_MESSAGE_VERSION,
        selection: this.#selection.selection,
        sentenceContext: this.#selection.sentenceContext,
        type: "store/analysis-start",
      });
    } catch {
      this.#activePort = null;
      this.#finishWithError(action, "internal-error");
    }
  }

  #receive(port: ContentAnalysisPort, action: AnalysisAction, value: unknown): void {
    if (port !== this.#activePort || this.#cardSession?.currentAction() !== action) return;
    let message;
    try {
      message = parseContentAnalysisMessage(value);
    } catch {
      this.#finishWithError(action, "invalid-response");
      return;
    }
    if (message.type === "store/analysis-error") {
      if (
        message.requestId !== null &&
        this.#remoteRequestId !== null &&
        message.requestId !== this.#remoteRequestId
      ) {
        this.#finishWithError(action, "invalid-response");
        return;
      }
      this.#finishWithError(action, message.code);
      showQueryDiagnostic(this.#analysisBody, message.diagnosticId);
      return;
    }
    if (message.type === "store/analysis-update") {
      measureQueryPresentation(this.#document, performance.now());
      const { update } = message;
      if (this.#remoteRequestId !== null && update.requestId !== this.#remoteRequestId) {
        this.#finishWithError(action, "invalid-response");
        return;
      }
      this.#remoteRequestId = update.requestId;
      if (update.type === "progress") {
        this.#renderStatus();
        return;
      }
      if (update.sequence <= this.#lastSequence) {
        this.#finishWithError(action, "invalid-response");
        return;
      }
      this.#lastSequence = update.sequence;
      if (update.type === "delta") {
        const current = this.#preview.get(update.section) ?? "";
        const total = Array.from(this.#preview.values()).reduce(
          (sum, text) => sum + text.length,
          0,
        );
        if (total + update.text.length > MAX_PREVIEW_CHARACTERS) {
          this.#finishWithError(action, "invalid-response");
          return;
        }
        this.#preview.set(update.section, current + update.text);
      } else {
        this.#previewSections.set(update.section, update);
      }
      this.#renderPreview();
      return;
    }
    if (
      this.#selection === null ||
      message.result.sourceText !== this.#selection.selection ||
      message.result.selectionKind !== this.#selection.selectionKind ||
      !resultMatchesAction(message.result.type, action) ||
      (this.#remoteRequestId !== null && message.result.requestId !== this.#remoteRequestId)
    ) {
      this.#finishWithError(action, "invalid-response");
      return;
    }
    this.#remoteRequestId = message.result.requestId;
    this.#stopPort(false);
    this.#cardSession?.complete(action, message.result);
    updateOverlayModeControls(this.#host, action, false);
    this.#renderReady(message.result);
  }

  #renderPreview(): void {
    if (this.#analysisBody === null) return;
    delete this.#analysisBody.dataset.resultType;
    renderStreamPreview(this.#analysisBody, this.#preview, this.#previewSections);
    this.#interaction.position();
  }

  #renderStatus(): void {
    if (this.#analysisBody === null) return;
    delete this.#analysisBody.dataset.resultType;
    renderStreamStatus(this.#analysisBody);
    this.#interaction.position();
  }

  #renderModeState(action: AnalysisAction, state: OverlayModeState): void {
    if (state.status === "ready") {
      this.#renderReady(state.result);
      return;
    }
    if (state.status === "error") {
      this.#renderError(action, state.code);
      return;
    }
    if (state.status === "disconnected" && this.#analysisBody !== null) {
      delete this.#analysisBody.dataset.resultType;
      renderDisconnectedError(
        this.#analysisBody,
        this.#acceptsUserGesture,
        () => {
          this.#cardSession?.retry(action);
          this.#start(action);
        },
        this.#preview.size > 0 || this.#previewSections.size > 0,
      );
      return;
    }
    this.#renderStatus();
  }

  #renderReady(result: AnalysisResult): void {
    if (this.#analysisBody === null || this.#selection === null) return;
    if (this.#headerActions === null) return;
    renderCachedResult({
      acceptsUserGesture: this.#acceptsUserGesture,
      body: this.#analysisBody,
      headerActions: this.#headerActions,
      presence: this.#wordPresence,
      result,
      saveWord: (request) => this.#runtime.saveWord(request),
      sentence: this.#selection.sentenceContext ?? this.#selection.selection,
    });
    if (this.#footer) this.#studyCapture.render(this.#footer, this.#selection);
    this.#interaction.position();
  }

  #finishWithError(action: AnalysisAction, code: StoreAnalysisErrorCode): void {
    this.#stopPort(false);
    this.#cardSession?.fail(action, code);
    updateOverlayModeControls(this.#host, action, false);
    this.#renderError(action, code);
  }

  #renderError(action: AnalysisAction, code: StoreAnalysisErrorCode): void {
    if (this.#analysisBody === null) return;
    delete this.#analysisBody.dataset.resultType;
    renderOverlayError({
      acceptsUserGesture: this.#acceptsUserGesture,
      body: this.#analysisBody,
      code,
      onOpenOptions: () => this.#runtime.openOptions(),
      onOpenOptionsError: () => {
        this.#cardSession?.fail(action, "internal-error");
        this.#renderError(action, "internal-error");
      },
      preservePreview: this.#preview.size > 0 || this.#previewSections.size > 0,
      onRetry: () => {
        this.#cardSession?.retry(action);
        this.#start(action);
      },
    });
    if (this.#selection && this.#footer) this.#studyCapture.render(this.#footer, this.#selection);
    this.#interaction.position();
  }

  #disconnected(port: ContentAnalysisPort, action: AnalysisAction): void {
    if (port !== this.#activePort) return;
    this.#activePort = null;
    this.#cardSession?.disconnect(action);
    updateOverlayModeControls(this.#host, action, false);
    if (this.#analysisBody === null) return;
    delete this.#analysisBody.dataset.resultType;
    renderDisconnectedError(
      this.#analysisBody,
      this.#acceptsUserGesture,
      () => {
        this.#cardSession?.retry(action);
        this.#start(action);
      },
      this.#preview.size > 0 || this.#previewSections.size > 0,
    );
    this.#interaction.position();
  }

  #stopPort(cancel: boolean): void {
    const port = this.#activePort;
    if (port === null) return;
    this.#activePort = null;
    disconnectAnalysisPort(port, cancel);
  }

  #removeOverlay(reason: StoreOverlayCloseReason | "replacement"): void {
    const hadOverlay = this.#host !== null;
    const onDismiss = this.#onDismiss;
    this.#stopPort(false);
    this.#interaction.stop();
    this.#host?.remove();
    this.#host = null;
    this.#analysisBody = null;
    this.#footer = null;
    this.#cardSession = null;
    this.#headerActions = null;
    this.#promoteToResult = null;
    this.#selection = null;
    this.#onDismiss = null;
    this.#wordPresence.reset();
    this.#studyCapture.reset();
    restoreQueryFocus(this.#previousFocus, reason !== "replacement");
    this.#previousFocus = null;
    if (hadOverlay && reason !== "replacement") this.#document.getSelection()?.removeAllRanges();
    if (hadOverlay && reason === "dismissed") onDismiss?.();
  }
}

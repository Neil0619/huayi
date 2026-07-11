import type {
  AnalysisError,
  AnalysisResult,
  AnalyzeAction,
  WordbookAddOutcome,
} from "@huayi/protocol";

import type { SelectionRequestInput } from "../selection/read-selection.js";
import {
  OverlayStateMachine,
  type OverlayAnchorRect,
  type OverlayPoint,
  type OverlayState,
  type VisibleOverlayState,
} from "./overlay-state.js";
import {
  calculateOverlayPosition,
  clampOverlayPosition,
  type OverlaySize,
  type ViewportSize,
} from "./position-overlay.js";
import { renderOverlayPanel } from "./render-result.js";
import { renderToolbar } from "./render-toolbar.js";
import { overlayStyles } from "./styles.js";

export interface OverlayControllerOptions {
  document?: Document;
  onAddWord: (selection: SelectionRequestInput) => void;
  onAnalyze: (action: AnalyzeAction, selection: SelectionRequestInput) => void;
  onCancel: () => void;
}

interface DragSession {
  origin: OverlayPoint;
  pointer: OverlayPoint;
}

const FALLBACK_PANEL_SIZE: OverlaySize = { height: 320, width: 420 };
const FALLBACK_TOOLBAR_SIZE: OverlaySize = { height: 44, width: 180 };
const KEYBOARD_DRAG_STEP = 10;

function isVisibleState(state: OverlayState): state is VisibleOverlayState {
  return !["idle", "closed"].includes(state.status);
}

export class OverlayController {
  private readonly documentRef: Document;
  private readonly host: HTMLDivElement;
  private readonly machine = new OverlayStateMachine();
  private readonly options: OverlayControllerOptions;
  private dragSession: DragSession | null = null;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;

  readonly shadowRoot: ShadowRoot;

  constructor(options: OverlayControllerOptions) {
    this.options = options;
    this.documentRef = options.document ?? document;
    this.host = this.documentRef.createElement("div");
    this.host.dataset.huayiOverlayHost = "";
    this.shadowRoot = this.host.attachShadow({ mode: "open" });

    this.documentRef.addEventListener("keydown", this.handleKeydown, true);
    this.documentRef.addEventListener("pointerdown", this.handleOutsidePointerDown, true);
    this.documentRef.addEventListener("pointermove", this.handlePointerMove, true);
    this.documentRef.addEventListener("pointerup", this.handlePointerUp, true);
    this.documentRef.defaultView?.addEventListener("resize", this.handleResize);
  }

  get state(): OverlayState {
    return this.machine.state;
  }

  show(selection: SelectionRequestInput, anchorRect: OverlayAnchorRect): void {
    if (this.hasPendingRequest()) {
      this.options.onCancel();
    }
    this.clearSlowTimer();
    this.machine.dispatch({ anchorRect, selection, type: "SHOW_ACTIONS" });
    this.render();
  }

  start(action: AnalyzeAction): void {
    const current = this.machine.state;
    if (current.status !== "actions") {
      return;
    }

    this.machine.dispatch({ action, startedAt: Date.now(), type: "START" });
    this.render();
    this.scheduleSlowRender();
    this.options.onAnalyze(action, current.selection);
  }

  resolve(result: AnalysisResult): void {
    this.clearSlowTimer();
    this.machine.dispatch({ result, type: "RESOLVE" });
    this.render();
  }

  reject(error: AnalysisError): void {
    this.clearSlowTimer();
    this.machine.dispatch({ error, type: "REJECT" });
    this.render();
  }

  addWord(): void {
    const current = this.machine.state;
    if (current.status !== "result") {
      return;
    }
    const previousState = current;
    this.machine.dispatch({ type: "START_WORDBOOK" });
    if (this.machine.state === previousState) {
      return;
    }
    this.render();
    this.focusWordbookStatus();
    this.options.onAddWord(current.selection);
  }

  resolveWordbook(outcome: WordbookAddOutcome): void {
    this.machine.dispatch({ outcome, type: "RESOLVE_WORDBOOK" });
    this.render();
    this.focusWordbookStatus();
  }

  rejectWordbook(error: AnalysisError): void {
    this.machine.dispatch({ error, type: "REJECT_WORDBOOK" });
    this.render();
    this.focusWordbookStatus();
  }

  retry(): void {
    const current = this.machine.state;
    if (current.status !== "error" || !current.error.retryable) {
      return;
    }

    const { action, selection } = current;
    this.machine.dispatch({ startedAt: Date.now(), type: "RETRY" });
    this.render();
    this.scheduleSlowRender();
    this.options.onAnalyze(action, selection);
  }

  close(): void {
    if (this.hasPendingRequest()) {
      this.options.onCancel();
    }
    this.clearSlowTimer();
    this.dragSession = null;
    this.machine.dispatch({ type: "CLOSE" });
    this.host.remove();
  }

  destroy(): void {
    this.close();
    this.documentRef.removeEventListener("keydown", this.handleKeydown, true);
    this.documentRef.removeEventListener("pointerdown", this.handleOutsidePointerDown, true);
    this.documentRef.removeEventListener("pointermove", this.handlePointerMove, true);
    this.documentRef.removeEventListener("pointerup", this.handlePointerUp, true);
    this.documentRef.defaultView?.removeEventListener("resize", this.handleResize);
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && isVisibleState(this.machine.state)) {
      event.preventDefault();
      this.close();
    }
  };

  private readonly handleOutsidePointerDown = (event: PointerEvent): void => {
    if (isVisibleState(this.machine.state) && !event.composedPath().includes(this.host)) {
      this.close();
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.dragSession === null) {
      return;
    }

    const proposed = {
      left: this.dragSession.origin.left + event.clientX - this.dragSession.pointer.left,
      top: this.dragSession.origin.top + event.clientY - this.dragSession.pointer.top,
    };
    this.moveTo(proposed);
  };

  private readonly handlePointerUp = (): void => {
    this.dragSession = null;
  };

  private readonly handleResize = (): void => {
    this.positionCurrentRoot();
  };

  private render(): void {
    const state = this.machine.state;
    if (!isVisibleState(state)) {
      this.host.remove();
      return;
    }

    const previousBody = this.shadowRoot.querySelector<HTMLElement>(".huayi-body");
    const previousScrollTop = previousBody?.scrollTop ?? 0;
    const focusedAction =
      this.shadowRoot.activeElement instanceof HTMLElement
        ? this.shadowRoot.activeElement.dataset.action
        : undefined;
    const style = this.documentRef.createElement("style");
    style.textContent = overlayStyles;
    const root =
      state.status === "actions"
        ? renderToolbar(state, { onAction: (action) => this.start(action) })
        : renderOverlayPanel(state, {
            onAddWord: () => this.addWord(),
            onClose: () => this.close(),
            onRetry: () => this.retry(),
          });
    this.shadowRoot.replaceChildren(style, root);
    const nextBody = root.querySelector<HTMLElement>(".huayi-body");
    if (nextBody !== null) {
      nextBody.scrollTop = previousScrollTop;
    }
    if (focusedAction !== undefined) {
      const nextFocused = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.dataset.action === focusedAction,
      );
      nextFocused?.focus();
    }

    if (!this.host.isConnected) {
      this.documentRef.documentElement.append(this.host);
    }

    this.bindDrag(root);
    this.positionCurrentRoot();
  }

  private bindDrag(root: HTMLElement): void {
    const handle = root.querySelector<HTMLButtonElement>("[data-drag-handle]");
    if (handle === null) {
      return;
    }

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      this.dragSession = {
        origin: this.readRootPosition(root),
        pointer: { left: event.clientX, top: event.clientY },
      };
    });

    handle.addEventListener("keydown", (event) => {
      const movement: Record<string, OverlayPoint> = {
        ArrowDown: { left: 0, top: KEYBOARD_DRAG_STEP },
        ArrowLeft: { left: -KEYBOARD_DRAG_STEP, top: 0 },
        ArrowRight: { left: KEYBOARD_DRAG_STEP, top: 0 },
        ArrowUp: { left: 0, top: -KEYBOARD_DRAG_STEP },
      };
      const delta = movement[event.key];
      if (delta === undefined) {
        return;
      }
      event.preventDefault();
      const current = this.readRootPosition(root);
      this.moveTo({ left: current.left + delta.left, top: current.top + delta.top });
    });
  }

  private moveTo(point: OverlayPoint): void {
    const root = this.getCurrentRoot();
    if (root === null) {
      return;
    }

    const position = clampOverlayPosition(point, this.readRootSize(root), this.readViewport());
    this.machine.dispatch({ position, type: "MOVE" });
    this.applyPosition(root, position);
  }

  private positionCurrentRoot(): void {
    const state = this.machine.state;
    const root = this.getCurrentRoot();
    if (!isVisibleState(state) || root === null) {
      return;
    }

    const size = this.readRootSize(root);
    const viewport = this.readViewport();
    const position =
      state.position === undefined
        ? calculateOverlayPosition(state.anchorRect, size, viewport)
        : clampOverlayPosition(state.position, size, viewport);
    this.applyPosition(root, position);
  }

  private getCurrentRoot(): HTMLElement | null {
    return this.shadowRoot.querySelector<HTMLElement>(".huayi-root");
  }

  private readRootSize(root: HTMLElement): OverlaySize {
    const rect = root.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { height: rect.height, width: rect.width };
    }
    return this.machine.state.status === "actions" ? FALLBACK_TOOLBAR_SIZE : FALLBACK_PANEL_SIZE;
  }

  private readRootPosition(root: HTMLElement): OverlayPoint {
    return {
      left: Number.parseFloat(root.style.left) || 0,
      top: Number.parseFloat(root.style.top) || 0,
    };
  }

  private readViewport(): ViewportSize {
    const view = this.documentRef.defaultView;
    return {
      height: view?.innerHeight ?? this.documentRef.documentElement.clientHeight,
      width: view?.innerWidth ?? this.documentRef.documentElement.clientWidth,
    };
  }

  private applyPosition(root: HTMLElement, position: OverlayPoint): void {
    root.style.left = `${Math.round(position.left)}px`;
    root.style.top = `${Math.round(position.top)}px`;
  }

  private scheduleSlowRender(): void {
    this.clearSlowTimer();
    this.slowTimer = setTimeout(() => {
      if (this.machine.state.status === "loading") {
        this.render();
      }
    }, 8_000);
  }

  private clearSlowTimer(): void {
    if (this.slowTimer !== null) {
      clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
  }

  private hasPendingRequest(): boolean {
    const state = this.machine.state;
    return (
      state.status === "loading" ||
      (state.status === "result" && state.wordbook.status === "saving")
    );
  }

  private focusWordbookStatus(): void {
    const wordbookButton = this.shadowRoot.querySelector<HTMLButtonElement>(
      "[data-action='add-word']",
    );
    if (wordbookButton?.disabled === false) {
      wordbookButton.focus();
    } else {
      this.shadowRoot.querySelector<HTMLElement>(".huayi-wordbook")?.focus();
    }
  }
}

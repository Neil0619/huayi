import type { AnalyzeAction } from "@huayi/protocol";

import type { SelectionRequestInput } from "../selection/read-selection.js";
import type { FrameScheduler } from "./frame-scheduler.js";
import type { OverlayAnchorRect, OverlayPoint } from "./overlay-state.js";
import type { OverlayPreferredSide, OverlaySize, ViewportSize } from "./position-overlay.js";

export interface OverlayControllerOptions {
  document?: Document;
  frameScheduler?: FrameScheduler;
  onAddWord: (selection: SelectionRequestInput) => void;
  onAnalyze: (action: AnalyzeAction, selection: SelectionRequestInput) => void;
  onCancel: () => void;
}

export interface OverlayPresentation {
  dismissOnOutsidePointer?: boolean;
  onClose?: () => void;
  preferredSide?: OverlayPreferredSide;
  resolveAnchorRect?: () => OverlayAnchorRect;
  resolveMountTarget?: () => Element;
}

export interface DragSession {
  origin: OverlayPoint;
  pointer: OverlayPoint;
}

const FALLBACK_PANEL_SIZE: OverlaySize = { height: 320, width: 420 };
const FALLBACK_TOOLBAR_SIZE: OverlaySize = { height: 44, width: 180 };
const KEYBOARD_DRAG_STEP = 10;

export const KEYBOARD_DRAG_MOVEMENTS: Readonly<Record<string, OverlayPoint>> = {
  ArrowDown: { left: 0, top: KEYBOARD_DRAG_STEP },
  ArrowLeft: { left: -KEYBOARD_DRAG_STEP, top: 0 },
  ArrowRight: { left: KEYBOARD_DRAG_STEP, top: 0 },
  ArrowUp: { left: 0, top: -KEYBOARD_DRAG_STEP },
};

export function readOverlayRootSize(root: HTMLElement, isToolbar: boolean): OverlaySize {
  const rect = root.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { height: rect.height, width: rect.width };
  }
  return isToolbar ? FALLBACK_TOOLBAR_SIZE : FALLBACK_PANEL_SIZE;
}

export function readOverlayRootPosition(root: HTMLElement): OverlayPoint {
  return {
    left: Number.parseFloat(root.style.left) || 0,
    top: Number.parseFloat(root.style.top) || 0,
  };
}

export function readOverlayViewport(documentRef: Document): ViewportSize {
  const view = documentRef.defaultView;
  return {
    height: view?.innerHeight ?? documentRef.documentElement.clientHeight,
    width: view?.innerWidth ?? documentRef.documentElement.clientWidth,
  };
}

export function applyOverlayPosition(root: HTMLElement, position: OverlayPoint): void {
  root.style.left = `${Math.round(position.left)}px`;
  root.style.top = `${Math.round(position.top)}px`;
}

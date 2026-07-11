import type { AnalysisError, AnalysisResult, AnalyzeAction } from "@huayi/protocol";

import type { SelectionRequestInput } from "../selection/read-selection.js";

export interface OverlayAnchorRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

export interface OverlayPoint {
  left: number;
  top: number;
}

interface OverlaySession {
  anchorRect: OverlayAnchorRect;
  position?: OverlayPoint;
  selection: SelectionRequestInput;
}

export interface IdleOverlayState {
  status: "idle";
}

export interface ActionsOverlayState extends OverlaySession {
  status: "actions";
}

export interface LoadingOverlayState extends OverlaySession {
  action: AnalyzeAction;
  startedAt: number;
  status: "loading";
}

export interface ResultOverlayState extends OverlaySession {
  action: AnalyzeAction;
  result: AnalysisResult;
  startedAt: number;
  status: "result";
}

export interface ErrorOverlayState extends OverlaySession {
  action: AnalyzeAction;
  error: AnalysisError;
  startedAt: number;
  status: "error";
}

export interface ClosedOverlayState {
  status: "closed";
}

export type VisibleOverlayState =
  ActionsOverlayState | LoadingOverlayState | ResultOverlayState | ErrorOverlayState;
export type OverlayState = VisibleOverlayState | IdleOverlayState | ClosedOverlayState;

export type OverlayEvent =
  | ({ type: "SHOW_ACTIONS" } & Omit<OverlaySession, "position">)
  | { action: AnalyzeAction; startedAt: number; type: "START" }
  | { result: AnalysisResult; type: "RESOLVE" }
  | { error: AnalysisError; type: "REJECT" }
  | { startedAt: number; type: "RETRY" }
  | { position: OverlayPoint; type: "MOVE" }
  | { type: "CLOSE" };

function isVisible(state: OverlayState): state is VisibleOverlayState {
  return !["idle", "closed"].includes(state.status);
}

export function reduceOverlayState(state: OverlayState, event: OverlayEvent): OverlayState {
  if (event.type === "SHOW_ACTIONS") {
    return {
      anchorRect: event.anchorRect,
      selection: event.selection,
      status: "actions",
    };
  }

  if (event.type === "CLOSE") {
    return { status: "closed" };
  }

  if (event.type === "MOVE") {
    return isVisible(state) ? { ...state, position: event.position } : state;
  }

  if (state.status === "actions" && event.type === "START") {
    return {
      ...state,
      action: event.action,
      startedAt: event.startedAt,
      status: "loading",
    };
  }

  if (state.status === "loading" && event.type === "RESOLVE") {
    return { ...state, result: event.result, status: "result" };
  }

  if (state.status === "loading" && event.type === "REJECT") {
    return { ...state, error: event.error, status: "error" };
  }

  if (state.status === "error" && state.error.retryable && event.type === "RETRY") {
    const loadingState: LoadingOverlayState = {
      action: state.action,
      anchorRect: state.anchorRect,
      selection: state.selection,
      startedAt: event.startedAt,
      status: "loading",
    };
    return state.position === undefined
      ? loadingState
      : { ...loadingState, position: state.position };
  }

  return state;
}

export class OverlayStateMachine {
  private currentState: OverlayState = { status: "idle" };

  get state(): OverlayState {
    return this.currentState;
  }

  dispatch(event: OverlayEvent): OverlayState {
    this.currentState = reduceOverlayState(this.currentState, event);
    return this.currentState;
  }
}

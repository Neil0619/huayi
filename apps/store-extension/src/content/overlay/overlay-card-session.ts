import type { AnalysisAction, AnalysisResult, StoreAnalysisErrorCode } from "@huayi/store-domain";

export type OverlayModeState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly result: AnalysisResult; readonly status: "ready" }
  | { readonly code: StoreAnalysisErrorCode; readonly status: "error" }
  | { readonly status: "disconnected" };

export interface OverlayModeActivation {
  readonly cancelled: AnalysisAction | null;
  readonly shouldStart: boolean;
  readonly state: OverlayModeState;
}

const idle = (): OverlayModeState => ({ status: "idle" });

export class OverlayCardSession {
  #active: AnalysisAction | null = null;
  readonly #states: Record<AnalysisAction, OverlayModeState> = {
    explain: idle(),
    translate: idle(),
  };

  activate(action: AnalysisAction): OverlayModeActivation {
    const cancelled =
      this.#active !== null &&
      this.#active !== action &&
      this.#states[this.#active].status === "loading"
        ? this.#active
        : null;
    if (cancelled !== null) this.#states[cancelled] = idle();
    this.#active = action;
    const current = this.#states[action];
    if (current.status !== "idle") {
      return { cancelled, shouldStart: false, state: current };
    }
    const loading: OverlayModeState = { status: "loading" };
    this.#states[action] = loading;
    return { cancelled, shouldStart: true, state: loading };
  }

  currentAction(): AnalysisAction | null {
    return this.#active;
  }

  complete(action: AnalysisAction, result: AnalysisResult): void {
    if (this.#active === action && this.#states[action].status === "loading") {
      this.#states[action] = { result, status: "ready" };
    }
  }

  fail(action: AnalysisAction, code: StoreAnalysisErrorCode): void {
    if (this.#active === action) {
      this.#states[action] = { code, status: "error" };
    }
  }

  disconnect(action: AnalysisAction): void {
    if (this.#active === action && this.#states[action].status === "loading") {
      this.#states[action] = { status: "disconnected" };
    }
  }

  retry(action: AnalysisAction): void {
    if (this.#states[action].status === "error" || this.#states[action].status === "disconnected") {
      this.#states[action] = idle();
    }
  }
}

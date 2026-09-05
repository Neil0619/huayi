import type { PracticeSession } from "@huayi/cloud-contracts";
export type ModelTimingStage =
  | "provider-first-token"
  | "first-display-field"
  | "generation-complete"
  | "repair-start"
  | "repair-complete";
export interface ModelTextPreview {
  readonly section: string;
  readonly text: string;
  readonly sequence: number;
}
export interface ModelExecution {
  readonly onSession?: (session: PracticeSession) => void;
  readonly beforeDispatch?: () => Promise<void>;
  readonly signal?: AbortSignal;
  readonly onPreview?: (preview: ModelTextPreview) => void;
  readonly onTiming?: (stage: ModelTimingStage) => void;
}

/** One deadline covers the initial call and its single structural repair. */
export function modelDeadline(timeoutMs: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

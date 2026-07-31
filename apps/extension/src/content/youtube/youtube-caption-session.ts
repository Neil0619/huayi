import type { CaptionCapture } from "./caption-sentence-assembler.js";
import type { CaptionPickerView } from "./youtube-caption-view.js";

export interface CaptionSessionBase {
  generation: number;
  picker: CaptionPickerView;
  player: HTMLElement;
  video: HTMLVideoElement;
}

export interface CompletingCaptionSession extends CaptionSessionBase {
  capture: CaptionCapture;
  kind: "completing";
  timeoutId: ReturnType<typeof globalThis.setTimeout>;
}

export interface ReadyCaptionSession extends CaptionSessionBase {
  kind: "ready";
  resumeOnClose: boolean;
}

export type CaptionSession = CompletingCaptionSession | ReadyCaptionSession;

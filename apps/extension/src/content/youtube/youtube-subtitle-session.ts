import { reduceYouTubeCaptionState, type YouTubeCaptionState } from "./youtube-caption-state.js";
import type { YouTubeCaptionControllerOptions } from "./youtube-caption-controller-contract.js";

export function canReplaceSubtitleSelection(options: YouTubeCaptionControllerOptions): boolean {
  return !(options.canDismissSelection?.() === false && options.isOverlayVisible?.() === true);
}

interface DismissSubtitleSessionOptions {
  document: Document;
  overlayVisible: boolean;
  player: HTMLElement | null;
  resume: boolean;
  state: YouTubeCaptionState;
  video: HTMLVideoElement | null;
}

export interface DismissSubtitleSessionResult {
  notifyOverlay: boolean;
  resumeVideo: HTMLVideoElement | null;
  state: YouTubeCaptionState;
}

export function dismissSubtitleSession(
  options: DismissSubtitleSessionOptions,
): DismissSubtitleSessionResult {
  const ownership = options.state.pauseOwnership;
  const hadSelection = options.state.activeSelection !== null;
  let state = reduceYouTubeCaptionState(options.state, { type: "CLEAR_SELECTION" });
  state = reduceYouTubeCaptionState(state, { type: "REVOKE_PAUSE" });
  if (hadSelection) options.document.defaultView?.getSelection()?.removeAllRanges();
  const resumeVideo =
    options.resume &&
    ownership !== null &&
    ownership.generation === state.generation &&
    ownership.player === options.player &&
    ownership.video === options.video &&
    ownership.video.paused &&
    !ownership.video.ended
      ? ownership.video
      : null;
  return { notifyOverlay: hadSelection || options.overlayVisible, resumeVideo, state };
}

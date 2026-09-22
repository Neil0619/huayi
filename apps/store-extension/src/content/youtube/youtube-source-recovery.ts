import type {
  CaptionBridge,
  CaptionCaptureRequest,
  CapturedCaptionTrack,
} from "./youtube-bridge-client.js";
import {
  captionToggleState,
  isUsableYouTubePlayer,
  visibleCaptionText,
} from "./youtube-player-state.js";

function canCapture(player: HTMLElement | null, video: HTMLVideoElement | null): boolean {
  return (
    player !== null &&
    video !== null &&
    player.ownerDocument.querySelector(".html5-video-player") === player &&
    player.querySelector("video") === video &&
    isUsableYouTubePlayer(player, video) &&
    captionToggleState(player) === "on" &&
    visibleCaptionText(player) !== null
  );
}

/** Initial captures share three attempts per lifecycle; established checks remain one-shot. */
export class YouTubeSourceRecovery {
  #cancelWait: (() => void) | null = null;
  #remaining = 3;

  async capture(
    bridge: CaptionBridge,
    request: CaptionCaptureRequest,
    initial: boolean,
    isCurrent: () => boolean,
    player: HTMLElement | null,
    video: HTMLVideoElement | null,
  ): Promise<CapturedCaptionTrack | null> {
    if (!initial) return isCurrent() ? bridge.capture(request) : null;
    while (this.#remaining > 0 && isCurrent() && canCapture(player, video)) {
      this.#remaining -= 1;
      const source = await bridge.capture(request);
      // A returned track (including a rejected non-English track) is never retried.
      if (!isCurrent() || source !== null || this.#remaining === 0 || !canCapture(player, video)) {
        return source;
      }
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timeout);
          this.#cancelWait = null;
          resolve();
        };
        const timeout = setTimeout(finish, 200);
        this.#cancelWait = finish;
      });
    }
    return null;
  }

  cancel(reset: boolean): void {
    this.#cancelWait?.();
    if (reset) this.#remaining = 3;
  }
}

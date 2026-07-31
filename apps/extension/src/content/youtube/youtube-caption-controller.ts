import type { OverlayPresentation } from "../overlay/overlay-controller.js";
import type { OverlayAnchorRect } from "../overlay/overlay-state.js";
import type { SelectionRequestInput } from "../selection/read-selection.js";
import { isYouTubeWatchPage, readCurrentCaption } from "./caption-reader.js";
import {
  CaptionSentenceAssembler,
  type CaptionCaptureResult,
} from "./caption-sentence-assembler.js";
import {
  canUseCaptionPlayer,
  PLAYER_SELECTOR,
  SUBTITLES_BUTTON_SELECTOR,
} from "./youtube-caption-player.js";
import {
  createCaptionPickerView,
  createYouTubeControlView,
  type YouTubeControlView,
} from "./youtube-caption-view.js";
import type { CaptionSession, CaptionSessionBase } from "./youtube-caption-session.js";

export interface YouTubeCaptionSelectionEvent {
  anchorRect: OverlayAnchorRect;
  input: SelectionRequestInput;
  presentation: OverlayPresentation;
}

export interface YouTubeCaptionControllerOptions {
  completionWaitMs?: number;
  document?: Document;
  isWatchPage?: () => boolean;
  now?: () => number;
  onPresentationChange: () => void;
  onSelection: (event: YouTubeCaptionSelectionEvent) => void;
  onSessionClose: () => void;
  onWarmup: () => void;
}

const COMPLETION_WAIT_MS = 2_500;
export class YouTubeCaptionController {
  private readonly assembler = new CaptionSentenceAssembler();
  private readonly completionWaitMs: number;
  private readonly documentRef: Document;
  private readonly documentObserver: MutationObserver;
  private readonly isWatchPage: () => boolean;
  private readonly now: () => number;
  private readonly options: YouTubeCaptionControllerOptions;
  private readonly playerObserver: MutationObserver;
  private control: YouTubeControlView | null = null;
  private controlPlayer: HTMLElement | null = null;
  private destroyed = false;
  private generation = 0;
  private observedPlayer: HTMLElement | null = null;
  private observedVideo: HTMLVideoElement | null = null;
  private refreshScheduled = false;
  private session: CaptionSession | null = null;

  constructor(options: YouTubeCaptionControllerOptions) {
    this.options = options;
    this.completionWaitMs = options.completionWaitMs ?? COMPLETION_WAIT_MS;
    this.documentRef = options.document ?? document;
    this.isWatchPage = options.isWatchPage ?? (() => isYouTubeWatchPage(this.documentRef.location));
    this.now = options.now ?? (() => performance.now());
    this.documentObserver = new MutationObserver(() => this.scheduleRefresh());
    this.playerObserver = new MutationObserver(() => this.scheduleRefresh());
    this.documentObserver.observe(this.documentRef.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    this.documentRef.addEventListener("fullscreenchange", this.handlePresentationChange);
    this.documentRef.addEventListener("keydown", this.handleKeydown, true);
    this.documentRef.addEventListener("yt-navigate-finish", this.handleNavigation);
    this.documentRef.addEventListener("yt-page-data-updated", this.handleNavigation);
    this.refresh();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.closeSession(false);
    this.assembler.clear();
    this.documentObserver.disconnect();
    this.playerObserver.disconnect();
    this.observeVideo(null);
    this.removeControl();
    this.documentRef.removeEventListener("fullscreenchange", this.handlePresentationChange);
    this.documentRef.removeEventListener("keydown", this.handleKeydown, true);
    this.documentRef.removeEventListener("yt-navigate-finish", this.handleNavigation);
    this.documentRef.removeEventListener("yt-page-data-updated", this.handleNavigation);
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.session === null) {
      return;
    }
    event.preventDefault();
    this.closeSession(this.session.kind === "ready");
  };

  private readonly handleNavigation = (): void => {
    this.resetCaptionState();
    this.scheduleRefresh();
  };

  private readonly handlePresentationChange = (): void => {
    this.options.onPresentationChange();
    this.scheduleRefresh();
  };

  private readonly handleVideoEnded = (): void => {
    this.resetCaptionState();
  };

  private readonly handleVideoPause = (): void => {
    const session = this.session;
    if (session?.kind === "completing") {
      const caption = readCurrentCaption(session.player);
      const snapshot =
        caption === null
          ? null
          : this.assembler.observe({ observedAtMs: this.now(), text: caption.text });
      if (snapshot !== null) {
        session.picker.updateText(snapshot.text);
      }
      this.finalizeCompletion(snapshot?.complete === true ? "boundary" : "playback-stopped", false);
    }
  };

  private readonly handleVideoPlay = (): void => {
    if (this.session?.kind === "ready") {
      this.closeSession(false);
    }
  };

  private readonly handleVideoSeeking = (): void => {
    this.resetCaptionState();
  };

  private scheduleRefresh(): void {
    if (this.destroyed || this.refreshScheduled) {
      return;
    }
    this.refreshScheduled = true;
    queueMicrotask(() => {
      this.refreshScheduled = false;
      if (!this.destroyed) {
        this.refresh();
      }
    });
  }

  private refresh(): void {
    if (!this.isWatchPage()) {
      this.resetCaptionState();
      this.observePlayer(null);
      this.observeVideo(null);
      this.removeControl();
      return;
    }

    const player = this.documentRef.querySelector<HTMLElement>(PLAYER_SELECTOR);
    if (player === null) {
      this.resetCaptionState();
      this.observePlayer(null);
      this.observeVideo(null);
      this.removeControl();
      return;
    }
    if (this.observedPlayer !== null && this.observedPlayer !== player) {
      this.resetCaptionState();
    }
    this.observePlayer(player);
    this.ensureControl(player);

    const video = player.querySelector<HTMLVideoElement>("video");
    if (this.observedVideo !== null && this.observedVideo !== video) {
      this.resetCaptionState();
    }
    this.observeVideo(video);
    if (video === null || !canUseCaptionPlayer(player, video)) {
      this.resetCaptionState();
      this.control?.setState(false, false);
      return;
    }

    const caption = readCurrentCaption(player);
    if (caption !== null && this.session?.kind !== "ready") {
      const snapshot = this.assembler.observe({
        observedAtMs: this.now(),
        text: caption.text,
      });
      if (this.session?.kind === "completing") {
        this.session.picker.updateText(snapshot.text);
        if (snapshot.overflow) {
          this.finalizeCompletion("overflow", true);
        } else if (snapshot.complete) {
          this.finalizeCompletion("boundary", true);
        }
      }
    }

    const active = this.session !== null;
    this.control?.setState(caption !== null || active, active, this.session?.kind === "completing");
    if (active) {
      this.options.onPresentationChange();
    }
  }

  private ensureControl(player: HTMLElement): void {
    if (this.control !== null && this.controlPlayer === player && this.control.host.isConnected) {
      return;
    }
    this.removeControl();
    const subtitlesButton = player.querySelector<HTMLElement>(SUBTITLES_BUTTON_SELECTOR);
    if (subtitlesButton?.parentElement === null || subtitlesButton === null) {
      return;
    }
    this.control = createYouTubeControlView(this.documentRef, () => this.togglePicker());
    this.controlPlayer = player;
    subtitlesButton.before(this.control.host);
  }

  private observePlayer(player: HTMLElement | null): void {
    if (this.observedPlayer === player) {
      return;
    }
    this.playerObserver.disconnect();
    this.observedPlayer = player;
    if (player !== null) {
      this.playerObserver.observe(player, {
        attributeFilter: ["aria-hidden", "class", "style"],
        attributes: true,
        subtree: true,
      });
    }
  }

  private observeVideo(video: HTMLVideoElement | null): void {
    if (this.observedVideo === video) {
      return;
    }
    this.observedVideo?.removeEventListener("ended", this.handleVideoEnded);
    this.observedVideo?.removeEventListener("pause", this.handleVideoPause);
    this.observedVideo?.removeEventListener("play", this.handleVideoPlay);
    this.observedVideo?.removeEventListener("seeking", this.handleVideoSeeking);
    this.observedVideo = video;
    video?.addEventListener("ended", this.handleVideoEnded);
    video?.addEventListener("pause", this.handleVideoPause);
    video?.addEventListener("play", this.handleVideoPlay);
    video?.addEventListener("seeking", this.handleVideoSeeking);
  }

  private removeControl(): void {
    this.control?.host.remove();
    this.control = null;
    this.controlPlayer = null;
  }

  private openPicker(): void {
    const player = this.controlPlayer;
    if (player === null || this.session !== null) {
      return;
    }
    const video = player.querySelector<HTMLVideoElement>("video");
    const caption = readCurrentCaption(player);
    if (video === null || caption === null || !canUseCaptionPlayer(player, video)) {
      this.refresh();
      return;
    }

    const snapshot = this.assembler.observe({ observedAtMs: this.now(), text: caption.text });
    const capture = this.assembler.beginCapture(this.now());
    if (capture === null) {
      return;
    }

    const needsCompletion = !video.paused && !snapshot.complete;
    const generation = (this.generation += 1);
    const picker = createCaptionPickerView({
      captionText: capture.text,
      completeness: capture.complete ? "complete" : "best-effort",
      continueLabel: "取消",
      document: this.documentRef,
      mode: needsCompletion ? "completing" : "ready",
      onClose: () => this.closeSession(this.session?.kind === "ready"),
      onSelection: ({ input, resolveAnchorRect }) => {
        const anchorRect = resolveAnchorRect();
        this.options.onSelection({
          anchorRect,
          input,
          presentation: {
            preferredSide: "above",
            resolveAnchorRect,
            resolveMountTarget: () =>
              this.documentRef.fullscreenElement ?? this.documentRef.documentElement,
          },
        });
      },
    });
    player.append(picker.host);
    this.options.onWarmup();

    if (needsCompletion) {
      const timeoutId = globalThis.setTimeout(() => {
        if (this.session?.kind === "completing" && this.session.generation === generation) {
          this.finalizeCompletion("timeout", true);
        }
      }, this.completionWaitMs);
      this.session = { capture, generation, kind: "completing", picker, player, timeoutId, video };
      this.control?.setState(true, true, true);
      return;
    }

    const reason = snapshot.complete ? "boundary" : "playback-stopped";
    const result = this.assembler.resolveCapture(capture, reason);
    if (result === null) {
      picker.destroy();
      return;
    }
    this.enterReady({ generation, picker, player, video }, result, !video.paused);
  }

  private finalizeCompletion(
    reason: "boundary" | "overflow" | "playback-stopped" | "timeout",
    takePlaybackOwnership: boolean,
  ): void {
    const session = this.session;
    if (session?.kind !== "completing") {
      return;
    }
    globalThis.clearTimeout(session.timeoutId);
    const result = this.assembler.resolveCapture(session.capture, reason);
    if (result === null) {
      this.closeSession(false);
      return;
    }
    this.enterReady(session, result, takePlaybackOwnership && !session.video.paused);
  }

  private enterReady(
    session: CaptionSessionBase,
    result: CaptionCaptureResult,
    pauseOwned: boolean,
  ): void {
    session.picker.updateText(result.text);
    const resumeOnClose = pauseOwned && !session.video.ended;
    this.session = { ...session, kind: "ready", resumeOnClose };
    session.picker.setMode("ready", {
      completeness: result.completeness,
      continueLabel: resumeOnClose ? "继续播放" : "关闭取词",
    });
    this.control?.setState(true, true, false);
    if (resumeOnClose) {
      session.video.pause();
    }
  }

  private togglePicker(): void {
    if (this.session !== null) {
      this.closeSession(this.session.kind === "ready");
      return;
    }
    this.openPicker();
  }

  private closeSession(resume: boolean): void {
    const session = this.session;
    if (session === null) {
      return;
    }
    this.session = null;
    if (session.kind === "completing") {
      globalThis.clearTimeout(session.timeoutId);
      this.assembler.cancelCapture(session.capture);
    }
    session.picker.destroy();
    this.options.onSessionClose();

    if (
      resume &&
      session.kind === "ready" &&
      session.resumeOnClose &&
      session.video.paused &&
      !session.video.ended
    ) {
      void session.video.play().catch(() => undefined);
    }
    if (!this.destroyed) {
      this.scheduleRefresh();
    }
  }

  private resetCaptionState(): void {
    this.closeSession(false);
    this.assembler.clear();
  }
}

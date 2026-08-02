import type { OverlayPresentation } from "../overlay/overlay-controller.js";
import { createFrameScheduler, type FrameScheduler } from "../overlay/frame-scheduler.js";
import type { OverlayAnchorRect } from "../overlay/overlay-state.js";
import type { SelectionRequestInput } from "../selection/read-selection.js";
import { isYouTubeWatchPage } from "./caption-reader.js";
import {
  YouTubeCaptionContextSource,
  type YouTubeCaptionContext,
} from "./youtube-caption-context-source.js";
import {
  createCaptionPickerView,
  createYouTubeControlView,
  type CaptionPickerView,
  type YouTubeControlView,
} from "./youtube-caption-view.js";

export interface YouTubeCaptionSelectionEvent {
  anchorRect: OverlayAnchorRect;
  input: SelectionRequestInput;
  presentation: OverlayPresentation;
}

export interface YouTubeCaptionControllerOptions {
  captionContextSource?: YouTubeCaptionContext;
  document?: Document;
  frameScheduler?: FrameScheduler;
  isWatchPage?: () => boolean;
  onPresentationChange: () => void;
  onSelection: (event: YouTubeCaptionSelectionEvent) => void;
  onSessionClose: () => void;
  onWarmup: () => void;
}

interface CaptionSession {
  picker: CaptionPickerView;
  player: HTMLElement;
  resumeOnClose: boolean;
  video: HTMLVideoElement;
}

interface PendingCaptionSession {
  frameHandle: number;
  player: HTMLElement;
  resumeOnClose: boolean;
  video: HTMLVideoElement;
}

const PLAYER_SELECTOR = ".html5-video-player";
const SUBTITLES_BUTTON_SELECTOR = ".ytp-subtitles-button";

function canUsePlayer(player: HTMLElement, video: HTMLVideoElement): boolean {
  return (
    !player.classList.contains("ad-showing") &&
    !player.classList.contains("ytp-live") &&
    video.duration !== Number.POSITIVE_INFINITY &&
    !video.ended
  );
}

export class YouTubeCaptionController {
  private readonly captionContextSource: YouTubeCaptionContext;
  private readonly documentRef: Document;
  private readonly documentObserver: MutationObserver;
  private readonly isWatchPage: () => boolean;
  private readonly options: YouTubeCaptionControllerOptions;
  private readonly playerObserver: MutationObserver;
  private readonly frameScheduler: FrameScheduler;
  private control: YouTubeControlView | null = null;
  private controlPlayer: HTMLElement | null = null;
  private destroyed = false;
  private observedPlayer: HTMLElement | null = null;
  private pendingSession: PendingCaptionSession | null = null;
  private refreshScheduled = false;
  private session: CaptionSession | null = null;

  constructor(options: YouTubeCaptionControllerOptions) {
    this.options = options;
    this.documentRef = options.document ?? document;
    this.isWatchPage = options.isWatchPage ?? (() => isYouTubeWatchPage(this.documentRef.location));
    this.captionContextSource = options.captionContextSource ?? new YouTubeCaptionContextSource();
    this.frameScheduler =
      options.frameScheduler ?? createFrameScheduler(this.documentRef.defaultView);
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
    this.cancelPendingSession(true);
    this.closeSession(true);
    this.captionContextSource.clear();
    this.destroyed = true;
    this.documentObserver.disconnect();
    this.playerObserver.disconnect();
    this.removeControl();
    this.documentRef.removeEventListener("fullscreenchange", this.handlePresentationChange);
    this.documentRef.removeEventListener("keydown", this.handleKeydown, true);
    this.documentRef.removeEventListener("yt-navigate-finish", this.handleNavigation);
    this.documentRef.removeEventListener("yt-page-data-updated", this.handleNavigation);
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || (this.session === null && this.pendingSession === null)) {
      return;
    }
    event.preventDefault();
    this.cancelPendingSession(true);
    this.closeSession(true);
  };

  private readonly handleNavigation = (): void => {
    this.cancelPendingSession(false);
    this.closeSession(false);
    this.captionContextSource.clear();
    this.scheduleRefresh();
  };

  private readonly handlePresentationChange = (): void => {
    this.options.onPresentationChange();
    this.scheduleRefresh();
  };

  private readonly handleViewerPlayback = (): void => {
    this.cancelPendingSession(false);
    this.closeSession(false);
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
      this.cancelPendingSession(false);
      this.closeSession(false);
      this.captionContextSource.clear();
      this.observePlayer(null);
      this.removeControl();
      return;
    }

    const player = this.documentRef.querySelector<HTMLElement>(PLAYER_SELECTOR);
    if (player === null) {
      this.cancelPendingSession(false);
      this.closeSession(false);
      this.captionContextSource.clear();
      this.observePlayer(null);
      this.removeControl();
      return;
    }
    if (this.pendingSession !== null && this.pendingSession.player !== player) {
      this.cancelPendingSession(false);
    }
    if (this.session !== null && this.session.player !== player) {
      this.closeSession(false);
    }
    this.observePlayer(player);
    this.ensureControl(player);

    const video = player.querySelector<HTMLVideoElement>("video");
    if (video === null || !canUsePlayer(player, video)) {
      this.cancelPendingSession(false);
      this.closeSession(false);
      this.captionContextSource.clear();
      this.control?.setState(false, false);
      return;
    }
    if (this.pendingSession !== null && this.pendingSession.video !== video) {
      this.cancelPendingSession(false);
    }
    if (this.session !== null && this.session.video !== video) {
      this.closeSession(false);
    }
    this.captionContextSource.attach(player, video, () => this.scheduleRefresh());
    const active = this.session !== null || this.pendingSession !== null;
    const enabled = active || this.captionContextSource.freeze() !== null;
    this.control?.setState(enabled, active);
    if (this.session !== null) {
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

  private removeControl(): void {
    this.control?.host.remove();
    this.control = null;
    this.controlPlayer = null;
  }

  private beginOpenPicker(): void {
    const player = this.controlPlayer;
    if (player === null || this.session !== null || this.pendingSession !== null) {
      return;
    }
    const video = player.querySelector<HTMLVideoElement>("video");
    if (video === null || !canUsePlayer(player, video)) {
      this.refresh();
      return;
    }

    const resumeOnClose = !video.paused && !video.ended;
    video.pause();
    const pending: PendingCaptionSession = {
      frameHandle: 0,
      player,
      resumeOnClose,
      video,
    };
    this.pendingSession = pending;
    pending.frameHandle = this.frameScheduler.request(() => this.finishOpenPicker(pending));
    if (this.pendingSession !== pending) {
      return;
    }
    video.addEventListener("ended", this.handleViewerPlayback);
    video.addEventListener("play", this.handleViewerPlayback);
    video.addEventListener("seeking", this.handleViewerPlayback);
    this.control?.setState(true, true);
  }

  private finishOpenPicker(pending: PendingCaptionSession): void {
    if (this.pendingSession !== pending) {
      return;
    }
    this.removePendingPlaybackListeners(pending);
    this.pendingSession = null;
    const snapshot = this.captionContextSource.freeze();
    if (
      !this.isWatchPage() ||
      this.controlPlayer !== pending.player ||
      !pending.player.isConnected ||
      snapshot === null ||
      !canUsePlayer(pending.player, pending.video)
    ) {
      this.resumePendingVideo(pending);
      this.scheduleRefresh();
      return;
    }
    const picker = createCaptionPickerView({
      captionText: snapshot.text,
      continueLabel: pending.resumeOnClose ? "继续播放" : "关闭取词",
      document: this.documentRef,
      onClose: () => this.closeSession(true),
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
    pending.player.append(picker.host);
    this.session = {
      picker,
      player: pending.player,
      resumeOnClose: pending.resumeOnClose,
      video: pending.video,
    };
    pending.video.addEventListener("ended", this.handleViewerPlayback);
    pending.video.addEventListener("play", this.handleViewerPlayback);
    pending.video.addEventListener("seeking", this.handleViewerPlayback);
    this.control?.setState(true, true);
    this.options.onWarmup();
  }

  private togglePicker(): void {
    if (this.pendingSession !== null) {
      this.cancelPendingSession(true);
      return;
    }
    if (this.session !== null) {
      this.closeSession(true);
      return;
    }
    this.beginOpenPicker();
  }

  private cancelPendingSession(resume: boolean): void {
    const pending = this.pendingSession;
    if (pending === null) {
      return;
    }
    this.pendingSession = null;
    this.frameScheduler.cancel(pending.frameHandle);
    this.removePendingPlaybackListeners(pending);
    if (resume) {
      this.resumePendingVideo(pending);
    }
    if (!this.destroyed) {
      this.scheduleRefresh();
    }
  }

  private removePendingPlaybackListeners(pending: PendingCaptionSession): void {
    pending.video.removeEventListener("ended", this.handleViewerPlayback);
    pending.video.removeEventListener("play", this.handleViewerPlayback);
    pending.video.removeEventListener("seeking", this.handleViewerPlayback);
  }

  private resumePendingVideo(pending: PendingCaptionSession): void {
    if (pending.resumeOnClose && pending.video.paused && !pending.video.ended) {
      void pending.video.play().catch(() => undefined);
    }
  }

  private closeSession(resume: boolean): void {
    const session = this.session;
    if (session === null) {
      return;
    }
    this.session = null;
    session.video.removeEventListener("ended", this.handleViewerPlayback);
    session.video.removeEventListener("play", this.handleViewerPlayback);
    session.video.removeEventListener("seeking", this.handleViewerPlayback);
    session.picker.destroy();
    this.options.onSessionClose();

    if (resume && session.resumeOnClose && session.video.paused && !session.video.ended) {
      void session.video.play().catch(() => undefined);
    }
    if (!this.destroyed) {
      this.scheduleRefresh();
    }
  }
}

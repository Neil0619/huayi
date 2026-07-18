import type { OverlayPresentation } from "../overlay/overlay-controller.js";
import type { OverlayAnchorRect } from "../overlay/overlay-state.js";
import type { SelectionRequestInput } from "../selection/read-selection.js";
import { isYouTubeWatchPage, readCurrentCaption } from "./caption-reader.js";
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
  document?: Document;
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
  private readonly documentRef: Document;
  private readonly documentObserver: MutationObserver;
  private readonly isWatchPage: () => boolean;
  private readonly options: YouTubeCaptionControllerOptions;
  private readonly playerObserver: MutationObserver;
  private control: YouTubeControlView | null = null;
  private controlPlayer: HTMLElement | null = null;
  private destroyed = false;
  private observedPlayer: HTMLElement | null = null;
  private refreshScheduled = false;
  private session: CaptionSession | null = null;

  constructor(options: YouTubeCaptionControllerOptions) {
    this.options = options;
    this.documentRef = options.document ?? document;
    this.isWatchPage = options.isWatchPage ?? (() => isYouTubeWatchPage(this.documentRef.location));
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
    this.closeSession(true);
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
    if (event.key !== "Escape" || this.session === null) {
      return;
    }
    event.preventDefault();
    this.closeSession(true);
  };

  private readonly handleNavigation = (): void => {
    if (!this.isWatchPage()) {
      this.closeSession(false);
    }
    this.scheduleRefresh();
  };

  private readonly handlePresentationChange = (): void => {
    this.options.onPresentationChange();
    this.scheduleRefresh();
  };

  private readonly handleViewerPlayback = (): void => {
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
      this.closeSession(false);
      this.observePlayer(null);
      this.removeControl();
      return;
    }

    const player = this.documentRef.querySelector<HTMLElement>(PLAYER_SELECTOR);
    if (player === null) {
      this.closeSession(false);
      this.observePlayer(null);
      this.removeControl();
      return;
    }
    if (this.session !== null && this.session.player !== player) {
      this.closeSession(false);
    }
    this.observePlayer(player);
    this.ensureControl(player);

    const video = player.querySelector<HTMLVideoElement>("video");
    const enabled =
      this.session === null &&
      video !== null &&
      canUsePlayer(player, video) &&
      readCurrentCaption(player) !== null;
    this.control?.setState(enabled || this.session !== null, this.session !== null);
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

  private openPicker(): void {
    const player = this.controlPlayer;
    if (player === null || this.session !== null) {
      return;
    }
    const video = player.querySelector<HTMLVideoElement>("video");
    const snapshot = readCurrentCaption(player);
    if (video === null || snapshot === null || !canUsePlayer(player, video)) {
      this.refresh();
      return;
    }

    const resumeOnClose = !video.paused && !video.ended;
    if (resumeOnClose) {
      video.pause();
    }
    const picker = createCaptionPickerView({
      captionText: snapshot.text,
      continueLabel: resumeOnClose ? "继续播放" : "关闭取词",
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
    player.append(picker.host);
    this.session = { picker, player, resumeOnClose, video };
    video.addEventListener("ended", this.handleViewerPlayback);
    video.addEventListener("play", this.handleViewerPlayback);
    video.addEventListener("seeking", this.handleViewerPlayback);
    this.control?.setState(true, true);
    this.options.onWarmup();
  }

  private togglePicker(): void {
    if (this.session !== null) {
      this.closeSession(true);
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

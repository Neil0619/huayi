import { isYouTubeWatchPage, readCurrentCaption } from "./caption-reader.js";
import {
  LocalSubtitleSentenceSegmenter,
  type SubtitleSentence,
  type SubtitleSentenceSegmenter,
} from "./subtitle-sentence-segmenter.js";
import {
  initialYouTubeCaptionState,
  reduceYouTubeCaptionState,
  type YouTubeCaptionState,
} from "./youtube-caption-state.js";
import {
  YouTubeCaptionBridgeClient,
  videoIdFromUrl,
  type CapturedCaptionTrack,
  type YouTubeCaptionBridge,
} from "./youtube-caption-bridge-client.js";
import type { YouTubeCaptionControllerOptions } from "./youtube-caption-controller-contract.js";
import { YouTubeCaptionRuntime } from "./youtube-caption-runtime.js";
import { YouTubeCaptionPresentation } from "./youtube-caption-presentation.js";
import { loadYouTubeCaptionTracks } from "./youtube-caption-track-loader.js";
import { YouTubeCaptionSelectionController } from "./youtube-caption-selection-controller.js";
import { YouTubeTrackMismatchMonitor } from "./youtube-track-mismatch-monitor.js";
import { YouTubeSourceTrackReconciler } from "./youtube-source-track-reconciler.js";
import { canReplaceSubtitleSelection, dismissSubtitleSession } from "./youtube-subtitle-session.js";
import {
  hasVisibleSourceMismatch,
  isPlayerBlankPointerTarget,
  isUsableYouTubePlayer,
  isValidBridgePlayerState,
  readRawCaptionLanguage,
  readYouTubeCaptionToggleState,
} from "./youtube-player-state.js";
import { YouTubeBilingualKeyController } from "./youtube-bilingual-key-controller.js";

export class YouTubeCaptionController {
  private readonly bridge: YouTubeCaptionBridge;
  private readonly bilingualKeys: YouTubeBilingualKeyController;
  private readonly documentRef: Document;
  private readonly getVideoId: () => string | null;
  private readonly isWatchPage: () => boolean;
  private readonly observer: MutationObserver;
  private readonly options: YouTubeCaptionControllerOptions;
  private readonly presentation: YouTubeCaptionPresentation;
  private readonly runtime: YouTubeCaptionRuntime;
  private readonly selectionController: YouTubeCaptionSelectionController;
  private readonly segmenter: SubtitleSentenceSegmenter;
  private destroyed = false;
  private navigationPending = false;
  private player: HTMLElement | null = null;
  private refreshScheduled = false;
  private sourceLoading = false;
  private sourceAttempted = false;
  private sourceSentences: SubtitleSentence[] = [];
  private state: YouTubeCaptionState = initialYouTubeCaptionState();
  private translated: CapturedCaptionTrack | null = null;
  private readonly trackMismatchMonitor: YouTubeTrackMismatchMonitor;
  private readonly trackReconciler: YouTubeSourceTrackReconciler;
  private video: HTMLVideoElement | null = null;
  private videoId: string | null = null;

  constructor(options: YouTubeCaptionControllerOptions) {
    this.options = options;
    this.documentRef = options.document ?? document;
    this.getVideoId = options.getVideoId ?? (() => videoIdFromUrl(this.documentRef.URL));
    this.isWatchPage = options.isWatchPage ?? (() => isYouTubeWatchPage(this.documentRef.location));
    this.presentation = new YouTubeCaptionPresentation(this.documentRef);
    this.segmenter = options.segmenter ?? new LocalSubtitleSentenceSegmenter();
    this.trackMismatchMonitor = new YouTubeTrackMismatchMonitor(
      () => this.isTrackMismatch(),
      () => {
        void this.reconcileTrackMismatch();
      },
    );
    this.bridge =
      options.bridge ??
      new YouTubeCaptionBridgeClient({
        document: this.documentRef,
        validatePlayerState: (track, target) => this.validateBridgeResult(track, target),
      });
    this.trackReconciler = new YouTubeSourceTrackReconciler(this.bridge);
    this.bilingualKeys = new YouTubeBilingualKeyController(this.documentRef, {
      canHold: () =>
        this.state.translatedTrackReady &&
        this.state.activeSelection === null &&
        this.options.isOverlayVisible?.() !== true,
      setHolding: (value) => this.setHoldingShortcut(value),
    });
    this.selectionController = new YouTubeCaptionSelectionController(
      this.documentRef,
      this.presentation,
      {
        canReplace: () => canReplaceSubtitleSelection(this.options),
        getPlayer: () => this.player,
        getState: () => this.state,
        getVideo: () => this.video,
        onSelection: this.options.onSelection,
        onSelectionClose: () => this.dismissSelection(false, true),
        onWarmup: this.options.onWarmup,
        setState: (state) => {
          this.state = state;
        },
      },
    );
    this.observer = new MutationObserver(() => this.scheduleRefresh());
    this.observer.observe(this.documentRef.documentElement, {
      attributeFilter: ["aria-pressed", "class"],
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    this.runtime = new YouTubeCaptionRuntime(this.documentRef, {
      blur: this.bilingualKeys.handleBlur,
      fullscreenchange: this.handlePresentationChange,
      keydown: this.bilingualKeys.handleKeydown,
      keyup: this.bilingualKeys.handleKeyup,
      mouseup: this.selectionController.handleMouseup,
      navigation: this.handleNavigation,
      playback: this.handleViewerPlayback,
      pointerdown: this.handlePlayerPointerDown,
      selectionchange: this.selectionController.handleSelectionChange,
      timeupdate: this.handleTimeUpdate,
      visibilitychange: this.bilingualKeys.handleVisibilityChange,
    });
    this.refresh();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.dismissSelection(false, false);
    this.trackMismatchMonitor.clear();
    this.runtime.destroy();
    this.restoreNativeCaptions();
    this.observer.disconnect();
    this.bridge.destroy();
  }

  containsEvent(event: Event): boolean {
    return this.presentation.containsEvent(event);
  }

  releaseSelectionForExternalInteraction(): void {
    if (this.state.activeSelection !== null || this.state.pauseOwnership !== null)
      this.dismissSelection(false, true);
  }

  private readonly handleNavigation = (event: Event): void => {
    if (event.type === "yt-navigate-start") {
      this.navigationPending = true;
      this.startNewGeneration();
      return;
    }
    if (event.type === "yt-navigate-finish") this.navigationPending = false;
    this.scheduleRefresh();
  };

  private readonly handlePresentationChange = (): void => {
    this.options.onPresentationChange();
    this.renderAtCurrentTime();
  };

  private readonly handlePlayerPointerDown = (event: PointerEvent): void => {
    if (
      (this.state.activeSelection === null && this.options.isOverlayVisible?.() !== true) ||
      this.options.canDismissSelection?.() === false ||
      this.player === null ||
      !isPlayerBlankPointerTarget(event, this.player)
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.dismissSelection(true, true);
  };

  private readonly handleViewerPlayback = (): void => {
    if (this.state.activeSelection === null && this.state.pauseOwnership === null) return;
    this.state = reduceYouTubeCaptionState(this.state, { type: "REVOKE_PAUSE" });
    this.dismissSelection(true, false);
  };

  private readonly handleTimeUpdate = (): void => this.renderAtCurrentTime();

  private scheduleRefresh(): void {
    if (this.destroyed || this.refreshScheduled) return;
    this.refreshScheduled = true;
    queueMicrotask(() => {
      this.refreshScheduled = false;
      if (!this.destroyed) this.refresh();
    });
  }

  private refresh(): void {
    if (this.navigationPending) return;
    const player = this.documentRef.querySelector<HTMLElement>(".html5-video-player");
    const video = player?.querySelector<HTMLVideoElement>("video") ?? null;
    const videoId = this.getVideoId();
    const captionToggleState = player === null ? "unknown" : readYouTubeCaptionToggleState(player);
    if (
      !this.isWatchPage() ||
      player === null ||
      video === null ||
      videoId === null ||
      !isUsableYouTubePlayer(player, video) ||
      captionToggleState === "off"
    ) {
      this.startNewGeneration();
      return;
    }
    if (this.player !== player || this.video !== video || this.videoId !== videoId) {
      this.startNewGeneration();
      this.player = player;
      this.video = video;
      this.videoId = videoId;
      this.runtime.attachVideo(video);
    }
    if (captionToggleState === "unknown") {
      if (this.state.sourceTrackReady) this.ensureView();
      this.renderAtCurrentTime();
      return;
    }
    const trackMismatch =
      this.state.sourceTrackReady &&
      !this.sourceLoading &&
      !this.trackReconciler.isPending &&
      (this.trackReconciler.isSuspended ||
        readRawCaptionLanguage(player) === "other" ||
        hasVisibleSourceMismatch(player, video, this.sourceSentences, this.state));
    if (trackMismatch) {
      this.trackMismatchMonitor.observeMismatch();
      this.renderAtCurrentTime();
      return;
    }
    this.trackMismatchMonitor.clear();
    if (
      !this.sourceLoading &&
      !this.sourceAttempted &&
      !this.state.sourceTrackReady &&
      readCurrentCaption(player) !== null
    ) {
      void this.loadTracks(videoId);
    }
    if (this.state.sourceTrackReady) this.ensureView();
    this.renderAtCurrentTime();
  }

  private async loadTracks(expectedVideoId: string): Promise<void> {
    this.sourceAttempted = true;
    this.sourceLoading = true;
    const generation = this.state.generation;
    try {
      await loadYouTubeCaptionTracks({
        bridge: this.bridge,
        expectedVideoId,
        generation,
        isCurrent: () => this.isCurrent(generation, expectedVideoId),
        onSource: (_source, sentences) => {
          this.trackReconciler.resume();
          this.sourceSentences = sentences;
          this.state = reduceYouTubeCaptionState(this.state, { ready: true, type: "SOURCE_READY" });
          this.ensureView();
          this.renderAtCurrentTime();
        },
        onSourceFailure: () => {
          this.restoreNativeCaptions();
        },
        onTranslated: (translated) => {
          this.translated = translated;
          this.state = reduceYouTubeCaptionState(this.state, {
            ready: translated !== null,
            type: "TRANSLATED_READY",
          });
          this.presentation.updateControl(this.state);
          this.renderAtCurrentTime();
        },
        segmenter: this.segmenter,
      });
    } finally {
      if (this.isCurrent(generation, expectedVideoId)) {
        this.sourceLoading = false;
        this.scheduleRefresh();
      }
    }
  }

  private async reconcileTrackMismatch(): Promise<void> {
    if (!this.state.sourceTrackReady || this.videoId === null || !this.isTrackMismatch()) return;
    const generation = this.state.generation;
    const expectedVideoId = this.videoId;
    await this.trackReconciler.reconcile({
      expectedVideoId,
      generation,
      hasMismatch: () => this.hasCurrentTrackMismatch(),
      isCurrent: () => this.isCurrent(generation, expectedVideoId),
      onDifferentEnglish: () => {
        this.startNewGeneration();
        this.scheduleRefresh();
      },
      onSameSource: () => {
        this.ensureView();
        this.renderAtCurrentTime();
      },
      onSuspended: () => {
        this.restoreNativeCaptions();
      },
    });
  }

  private validateBridgeResult(
    track: { kind?: string; languageCode: string },
    target: "source" | "translated",
  ): boolean | "retry" {
    return isValidBridgePlayerState(this.player, this.video, track, target);
  }

  private isCurrent(generation: number, videoId: string): boolean {
    return !this.destroyed && this.state.generation === generation && this.videoId === videoId;
  }

  private ensureView(): void {
    if (this.player === null) return;
    this.presentation.ensure(this.player, this.state, () => {
      this.state = reduceYouTubeCaptionState(this.state, { type: "TOGGLE_PIN" });
      this.presentation.updateControl(this.state);
      this.renderAtCurrentTime();
    });
  }

  private renderAtCurrentTime(): void {
    this.presentation.render(
      this.player,
      this.video,
      this.state,
      this.sourceSentences,
      this.translated,
    );
  }

  private setHoldingShortcut(value: boolean): void {
    if (this.state.holdingShortcut === value) return;
    this.state = reduceYouTubeCaptionState(this.state, { type: "HOLD_SHORTCUT", value });
    this.renderAtCurrentTime();
  }

  private dismissSelection(notifyOverlay: boolean, resume: boolean): void {
    const dismissal = dismissSubtitleSession({
      document: this.documentRef,
      overlayVisible: this.options.isOverlayVisible?.() === true,
      player: this.player,
      resume,
      state: this.state,
      video: this.video,
    });
    this.state = dismissal.state;
    if (notifyOverlay && dismissal.notifyOverlay) this.options.onSessionClose();
    if (dismissal.resumeVideo !== null) {
      void dismissal.resumeVideo.play().catch(() => undefined);
    }
    this.renderAtCurrentTime();
  }

  private startNewGeneration(): void {
    this.trackMismatchMonitor.clear();
    this.dismissSelection(true, false);
    this.runtime.detachVideo();
    this.restoreNativeCaptions();
    this.translated = null;
    this.sourceSentences = [];
    this.sourceLoading = false;
    this.trackReconciler.reset();
    this.sourceAttempted = false;
    this.player = null;
    this.video = null;
    this.videoId = null;
    this.state = reduceYouTubeCaptionState(this.state, {
      generation: this.state.generation + 1,
      type: "NEW_GENERATION",
    });
  }

  private restoreNativeCaptions(): void {
    if (this.player !== null) delete this.player.dataset.huayiYoutubeSubtitlesActive;
    this.presentation.restore();
  }

  private isTrackMismatch(): boolean {
    return (
      !this.destroyed &&
      !this.sourceLoading &&
      !this.trackReconciler.isPending &&
      this.hasCurrentTrackMismatch()
    );
  }

  private hasCurrentTrackMismatch(): boolean {
    return (
      this.state.sourceTrackReady &&
      this.player !== null &&
      this.video !== null &&
      (this.trackReconciler.isSuspended ||
        readRawCaptionLanguage(this.player) === "other" ||
        hasVisibleSourceMismatch(this.player, this.video, this.sourceSentences, this.state))
    );
  }
}

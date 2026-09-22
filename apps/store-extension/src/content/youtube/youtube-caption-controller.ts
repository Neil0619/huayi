import type { StoreAppearance } from "@huayi/store-domain";

import type { StoreOverlayAnchor } from "../overlay/store-overlay-controller.js";
import type { CaptionBridge, CapturedCaptionTrack } from "./youtube-bridge-client.js";
import { applyYouTubeSelectionBoundary } from "./youtube-selection-boundary.js";
import type { YouTubeCaptionControllerOptions } from "./youtube-caption-controller-contract.js";
import { SELECTION_PAUSE, TEMPORARY_PAUSE } from "./youtube-pause-ownership.js";
import type { YouTubePauseOwnership } from "./youtube-pause-ownership.js";
import { YouTubeCaptionSelectionGesture } from "./youtube-caption-selection-gesture.js";
import { readYouTubeCaptionSelection } from "./youtube-caption-selection-reading.js";
import {
  captureTranslatedCaption,
  waitForTranslatedCaptionRetry,
} from "./youtube-caption-translation.js";
import { YouTubeCaptionView } from "./youtube-caption-view.js";
import {
  alignTranslatedSentence,
  findSubtitleSentenceAt,
  segmentSubtitleCues,
  type SubtitleSentence,
} from "./youtube-subtitles.js";
import { isExactYouTubeWatchPage, videoIdFromYouTubeLocation } from "./youtube-location.js";
import { YouTubeDismissalGesture } from "./youtube-dismissal-gesture.js";
import {
  captionToggleState,
  isUsableYouTubePlayer,
  visibleCaptionText,
} from "./youtube-player-state.js";
import { formatYouTubeShortcutLabel, YouTubeShortcutController } from "./youtube-shortcut.js";
import { YouTubeSourceRecovery } from "./youtube-source-recovery.js";
import { YouTubeTemporaryTranslationHold } from "./youtube-temporary-translation-hold.js";
export class YouTubeCaptionController {
  readonly #acceptsUserGesture: (event: Event) => boolean;
  readonly #bridge: CaptionBridge;
  #appearance: StoreAppearance;
  readonly #dismissalGesture: YouTubeDismissalGesture;
  readonly #documentRef: Document;
  readonly #getVideoId: () => string | null;
  readonly #isWatchPage: () => boolean;
  readonly #mode: YouTubeCaptionControllerOptions["mode"];
  readonly #observer: MutationObserver;
  readonly #overlay: YouTubeCaptionControllerOptions["overlay"];
  readonly #selectionGesture: YouTubeCaptionSelectionGesture;
  readonly #shortcut: YouTubeShortcutController;
  readonly #shortcutLabel: string;
  readonly #temporaryHold: YouTubeTemporaryTranslationHold;
  readonly #waitForTranslatedRetry: () => Promise<void>;
  readonly #sourceRecovery = new YouTubeSourceRecovery();
  #generation = 0;
  #lastSourceAttemptCaption: string | null = null;
  #loading = false;
  readonly #pauseOwnerships: [YouTubePauseOwnership | null, YouTubePauseOwnership | null] = [
    null,
    null,
  ];
  #player: HTMLElement | null = null;
  #sentences: readonly SubtitleSentence[] = [];
  #selectionActive = false;
  #started = false;
  #translated: CapturedCaptionTrack | null = null;
  #video: HTMLVideoElement | null = null;
  #videoId: string | null = null;
  #view: YouTubeCaptionView | null = null;
  constructor(options: YouTubeCaptionControllerOptions) {
    this.#acceptsUserGesture = options.acceptsUserGesture ?? ((event) => event.isTrusted);
    this.#bridge = options.bridge;
    this.#appearance = options.appearance ?? "silver";
    this.#documentRef = options.document ?? document;
    this.#getVideoId =
      options.getVideoId ?? (() => videoIdFromYouTubeLocation(this.#documentRef.location));
    this.#isWatchPage =
      options.isWatchPage ?? (() => isExactYouTubeWatchPage(this.#documentRef.location));
    this.#mode = options.mode;
    this.#overlay = options.overlay;
    this.#shortcutLabel = formatYouTubeShortcutLabel(options.shortcut ?? null);
    this.#temporaryHold = new YouTubeTemporaryTranslationHold((holding) => {
      this.#view?.setTemporaryBilingual(holding);
      if (holding) this.#pauseVideoFor(TEMPORARY_PAUSE);
      else this.#resumeOwnedVideo(TEMPORARY_PAUSE);
      this.#render();
    });
    this.#selectionGesture = new YouTubeCaptionSelectionGesture({
      acceptsUserGesture: this.#acceptsUserGesture,
      canCommit: () => !this.#selectionActive,
      commit: () => this.#commitCaptionSelection(),
      document: this.#documentRef,
      getEnglish: () => this.#view?.english ?? null,
      hasValidSelection: () =>
        readYouTubeCaptionSelection(this.#documentRef, this.#view?.english ?? null) !== null,
      restore: () => this.#render(),
    });
    this.#shortcut = new YouTubeShortcutController(this.#documentRef, {
      canHold: () => this.#view?.canShowTranslation() ?? false,
      setHolding: (holding) => this.#temporaryHold.set("keyboard", holding),
      shortcut: options.shortcut ?? null,
    });
    this.#dismissalGesture = new YouTubeDismissalGesture({
      canDismiss: () => this.#selectionActive,
      dismiss: () => this.#overlay.close(),
      getPlayer: () => this.#player,
    });
    this.#waitForTranslatedRetry = options.waitForTranslatedRetry ?? waitForTranslatedCaptionRetry;
    this.#observer = new MutationObserver(() => this.#scheduleRefresh());
  }
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#setListeners("addEventListener");
    this.#selectionGesture.start();
    this.#observer.observe(this.#documentRef.documentElement, {
      attributeFilter: ["aria-pressed", "class"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    this.#refresh();
  }
  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#setListeners("removeEventListener");
    this.#selectionGesture.stop();
    this.#pauseOwnerships.fill(null);
    this.#shortcut.clear();
    this.#temporaryHold.clear();
    this.#observer.disconnect();
    this.#clearSession();
    this.#bridge.destroy();
  }

  #setListeners(method: "addEventListener" | "removeEventListener"): void {
    const listen: Document["addEventListener"] = this.#documentRef[method].bind(this.#documentRef);
    listen("pointerdown", this.#dismissalGesture.handlePointerDown, true);
    listen("click", this.#dismissalGesture.handleClick, true);
    listen("keydown", this.#shortcut.handleKeydown, true);
    listen("keyup", this.#shortcut.handleKeyup, true);
    listen("visibilitychange", this.#handleVisibilityChange);
    this.#documentRef.defaultView?.[method]("blur", this.#handleWindowBlur);
    listen("yt-navigate-start", this.#handleNavigation);
    listen("yt-navigate-finish", this.#handleNavigation);
  }
  setAppearance(appearance: StoreAppearance): void {
    this.#appearance = appearance;
    this.#view?.setAppearance(appearance);
  }
  #scheduleRefresh(): void {
    if (!this.#started) return;
    queueMicrotask(() => {
      if (this.#started) this.#refresh();
    });
  }
  #refresh(): void {
    const player = this.#documentRef.querySelector<HTMLElement>(".html5-video-player");
    const video = player?.querySelector<HTMLVideoElement>("video") ?? null;
    const videoId = this.#getVideoId();
    const toggleState = player === null ? "unknown" : captionToggleState(player);
    const visible = player === null ? null : visibleCaptionText(player);
    if (
      !this.#isWatchPage() ||
      player === null ||
      video === null ||
      videoId === null ||
      !isUsableYouTubePlayer(player, video) ||
      toggleState === "off"
    ) {
      this.#clearSession();
      return;
    }
    if (this.#player !== player || this.#video !== video || this.#videoId !== videoId) {
      this.#replacePlayer(player, video, videoId);
    }
    if (this.#sentences.length > 0) {
      const source = findSubtitleSentenceAt(this.#sentences, video.currentTime * 1_000);
      if (
        !this.#loading &&
        visible !== null &&
        source !== null &&
        visible !== this.#lastSourceAttemptCaption &&
        !source.text.includes(visible)
      ) {
        this.#lastSourceAttemptCaption = visible;
        void this.#load(videoId, this.#generation).catch(() => undefined);
        return;
      }
      this.#render();
      return;
    }
    if (this.#loading) return;
    if (toggleState !== "on") return;
    if (visible === null || visible === this.#lastSourceAttemptCaption) return;
    this.#lastSourceAttemptCaption = visible;
    void this.#load(videoId, this.#generation).catch(() => undefined);
  }
  async #load(expectedVideoId: string, generation: number): Promise<void> {
    this.#loading = true;
    try {
      const source = await this.#sourceRecovery.capture(
        this.#bridge,
        { expectedVideoId, generation, target: "source" },
        this.#sentences.length === 0,
        () => this.#isCurrent(expectedVideoId, generation),
        this.#player,
        this.#video,
      );
      if (!this.#isCurrent(expectedVideoId, generation)) return;
      if (source === null || !/^en(?:-|$)/iu.test(source.track.languageCode)) {
        if (this.#sentences.length > 0 && this.#player !== null && this.#video !== null) {
          const rejected = this.#lastSourceAttemptCaption;
          this.#replacePlayer(this.#player, this.#video, expectedVideoId, false);
          this.#lastSourceAttemptCaption = rejected;
        } else if (this.#player === null || visibleCaptionText(this.#player) === null) {
          this.#lastSourceAttemptCaption = null;
        }
        return;
      }
      const sentences = segmentSubtitleCues(source.cues);
      if (sentences.length === 0) return;
      this.#sentences = sentences;
      this.#ensureView();
      this.#render();
      const translated = await captureTranslatedCaption(
        this.#bridge,
        expectedVideoId,
        generation,
        () => this.#isCurrent(expectedVideoId, generation),
        this.#waitForTranslatedRetry,
      );
      if (!this.#isCurrent(expectedVideoId, generation)) return;
      this.#translated = translated;
      this.#render();
    } finally {
      if (this.#isCurrent(expectedVideoId, generation)) {
        this.#loading = false;
        this.#scheduleRefresh();
      }
    }
  }
  #ensureView(): void {
    // The following render mounts controls for both new and existing views.
    if (this.#player === null || this.#view !== null) return;
    this.#view = new YouTubeCaptionView(
      this.#documentRef,
      this.#player,
      this.#mode === "bilingual",
      () => {
        this.#view?.toggleBilingual();
        this.#render();
      },
      (holding) => this.#temporaryHold.set("pointer", holding),
      this.#shortcutLabel,
      this.#appearance,
    );
  }
  readonly #render = (): void => {
    if (this.#video === null || this.#view === null) return;
    if (this.#player !== null) this.#view.mountControl(this.#player);
    if (this.#selectionGesture.active || this.#selectionActive) return;
    const sentence = findSubtitleSentenceAt(this.#sentences, this.#video.currentTime * 1_000);
    const translated =
      sentence === null || this.#translated === null
        ? null
        : alignTranslatedSentence(sentence, this.#translated.cues);
    this.#view.render(sentence, translated, this.#translated !== null);
  };
  #commitCaptionSelection(): void {
    const selected = readYouTubeCaptionSelection(this.#documentRef, this.#view?.english ?? null);
    if (selected === null) {
      this.#render();
      return;
    }
    const rect = selected.range.getBoundingClientRect();
    const temporaryOwnership = this.#pauseOwnerships[TEMPORARY_PAUSE];
    const transferred = temporaryOwnership !== null && this.#isCurrentOwnership(temporaryOwnership);
    if (transferred) {
      this.#pauseOwnerships[SELECTION_PAUSE] = temporaryOwnership;
      this.#pauseOwnerships[TEMPORARY_PAUSE] = null;
    }
    this.#temporaryHold.clear();
    if (!transferred) this.#pauseVideoFor(SELECTION_PAUSE);
    this.#selectionActive = true;
    const selectionRight = Number.isFinite(rect.right) ? rect.right : rect.left;
    const anchor: StoreOverlayAnchor = {
      bottom: rect.bottom,
      left: (rect.left + selectionRight) / 2,
      top: rect.top,
    };
    this.#overlay.show(
      applyYouTubeSelectionBoundary(selected.reading, selected.text.data),
      anchor,
      () => {
        this.#selectionActive = false;
        this.#render();
        this.#resumeOwnedVideo(SELECTION_PAUSE);
      },
    );
  }
  readonly #handleVisibilityChange = (): void => {
    this.#shortcut.handleVisibilityChange();
    if (this.#documentRef.visibilityState === "hidden") this.#temporaryHold.clear();
  };
  readonly #handleWindowBlur = (): void => {
    this.#shortcut.clear();
    this.#temporaryHold.clear();
    if (!this.#selectionActive) this.#selectionGesture.clear();
  };
  readonly #handleVideoPlay = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLVideoElement)) return;
    for (const owner of [SELECTION_PAUSE, TEMPORARY_PAUSE]) {
      if (this.#pauseOwnerships[owner]?.[2] === event.currentTarget)
        this.#pauseOwnerships[owner] = null;
    }
  };
  readonly #handleNavigation = (event: Event): void => {
    if (event.type === "yt-navigate-start") this.#clearSession();
    else this.#scheduleRefresh();
  };
  #isCurrent(videoId: string, generation: number): boolean {
    return (
      this.#started &&
      this.#videoId === videoId &&
      this.#generation === generation &&
      this.#getVideoId() === videoId &&
      this.#isWatchPage()
    );
  }
  #isCurrentOwnership(ownership: YouTubePauseOwnership): boolean {
    return (
      this.#started &&
      this.#generation === ownership[0] &&
      this.#player === ownership[1] &&
      this.#video === ownership[2] &&
      this.#videoId === ownership[3]
    );
  }
  #pauseVideoFor(owner: 0 | 1): void {
    const player = this.#player;
    const video = this.#video;
    const videoId = this.#videoId;
    if (player === null || video === null || videoId === null || video.paused || video.ended)
      return;
    video.pause();
    this.#pauseOwnerships[owner] = [this.#generation, player, video, videoId];
  }
  #resumeOwnedVideo(owner: 0 | 1): void {
    const ownership = this.#pauseOwnerships[owner];
    this.#pauseOwnerships[owner] = null;
    if (ownership === null || !this.#isCurrentOwnership(ownership)) return;
    if (!ownership[2].paused || ownership[2].ended) return;
    try {
      void ownership[2].play().catch(() => undefined);
    } catch {
      // A stale or policy-blocked media element fails closed without retrying.
    }
  }
  #replacePlayer(
    player: HTMLElement,
    video: HTMLVideoElement,
    videoId: string,
    resetSource = true,
  ): void {
    this.#clearSession(resetSource);
    this.#player = player;
    this.#video = video;
    this.#videoId = videoId;
    video.addEventListener("play", this.#handleVideoPlay);
    video.addEventListener("timeupdate", this.#render);
  }
  #clearSession(resetSource = true): void {
    this.#generation += 1;
    this.#sourceRecovery.cancel(resetSource);
    this.#dismissalGesture.clear();
    this.#pauseOwnerships.fill(null);
    this.#temporaryHold.clear();
    this.#selectionActive = false;
    this.#selectionGesture.clear();
    this.#video?.removeEventListener("play", this.#handleVideoPlay);
    this.#video?.removeEventListener("timeupdate", this.#render);
    this.#view?.destroy();
    this.#view = null;
    this.#sentences = [];
    this.#translated = null;
    this.#lastSourceAttemptCaption = null;
    this.#loading = false;
    this.#player = null;
    this.#video = null;
    this.#videoId = null;
    this.#overlay.close("owner-clear");
  }
}

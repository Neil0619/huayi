import type { SubtitleSentence } from "./subtitle-sentence-segmenter.js";
import type { CapturedCaptionTrack } from "./youtube-caption-bridge-client.js";
import { renderYouTubeCaption } from "./youtube-caption-renderer.js";
import type { YouTubeCaptionState } from "./youtube-caption-state.js";
import { createYouTubeCaptionView, type YouTubeCaptionView } from "./youtube-caption-view.js";
import { readNativeSubtitleSelection } from "./youtube-native-selection.js";

export class YouTubeCaptionPresentation {
  private currentSentence: SubtitleSentence | null = null;
  private view: YouTubeCaptionView | null = null;

  constructor(private readonly documentRef: Document) {}

  containsEvent(event: Event): boolean {
    return event
      .composedPath()
      .some(
        (target) =>
          target instanceof HTMLElement && target.dataset.huayiYoutubeSubtitleSurface !== undefined,
      );
  }

  containsEnglishTarget(event: Event): boolean {
    return this.view !== null && event.composedPath().includes(this.view.english);
  }

  ensure(
    player: HTMLElement,
    state: YouTubeCaptionState,
    onToggle: () => void,
    onTemporaryHold: (holding: boolean) => void,
    shortcutLabel: string,
  ): void {
    if (this.view?.host.isConnected === true) {
      this.view.mountControl(player);
      this.updateControl(state);
      return;
    }
    this.view?.destroy();
    this.view = createYouTubeCaptionView(
      this.documentRef,
      player,
      onToggle,
      onTemporaryHold,
      shortcutLabel,
    );
    this.updateControl(state);
  }

  updateControl(state: YouTubeCaptionState): void {
    this.view?.setBilingualControl(state.translatedTrackReady, state.pinnedBilingual);
  }

  render(
    player: HTMLElement | null,
    video: HTMLVideoElement | null,
    state: YouTubeCaptionState,
    sourceSentences: readonly SubtitleSentence[],
    translated: CapturedCaptionTrack | null,
  ): void {
    if (this.view === null || player === null || video === null) return;
    this.currentSentence = renderYouTubeCaption(
      this.view,
      player,
      video.currentTime * 1_000,
      state,
      sourceSentences,
      translated,
    );
  }

  readSelection(selection: Selection | null, state: YouTubeCaptionState) {
    if (this.view === null) return null;
    const sentence = state.activeSelection?.sentence ?? this.currentSentence;
    return sentence === null
      ? null
      : readNativeSubtitleSelection(selection, this.view.english, sentence);
  }

  restore(): void {
    this.view?.destroy();
    this.view = null;
    this.currentSentence = null;
  }
}

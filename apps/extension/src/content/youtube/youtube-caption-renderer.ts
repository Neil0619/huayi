import {
  alignTranslatedSentence,
  findSubtitleSentenceAt,
  type SubtitleSentence,
} from "./subtitle-sentence-segmenter.js";
import { shouldShowTranslation, type YouTubeCaptionState } from "./youtube-caption-state.js";
import type { CapturedCaptionTrack } from "./youtube-caption-bridge-client.js";
import type { YouTubeCaptionView } from "./youtube-caption-view.js";

export function renderYouTubeCaption(
  view: YouTubeCaptionView,
  player: HTMLElement,
  timeMs: number,
  state: YouTubeCaptionState,
  sentences: readonly SubtitleSentence[],
  translatedTrack: CapturedCaptionTrack | null,
): SubtitleSentence | null {
  const sentence = state.activeSelection?.sentence ?? findSubtitleSentenceAt(sentences, timeMs);
  if (sentence === null) {
    view.host.hidden = true;
    delete player.dataset.huayiYoutubeSubtitlesActive;
    return null;
  }
  const translated =
    translatedTrack === null ? null : alignTranslatedSentence(sentence, translatedTrack.cues);
  view.update(sentence.text, translated, shouldShowTranslation(state));
  view.host.hidden = false;
  player.dataset.huayiYoutubeSubtitlesActive = "";
  return sentence;
}

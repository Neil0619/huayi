import type { SubtitleSentence, SubtitleSentenceSegmenter } from "./subtitle-sentence-segmenter.js";
import type {
  CapturedCaptionTrack,
  YouTubeCaptionBridge,
} from "./youtube-caption-bridge-client.js";

interface YouTubeCaptionTrackLoaderOptions {
  bridge: YouTubeCaptionBridge;
  expectedVideoId: string;
  generation: number;
  isCurrent: () => boolean;
  onSource: (source: CapturedCaptionTrack, sentences: SubtitleSentence[]) => void;
  onSourceFailure: () => void;
  onTranslated: (translated: CapturedCaptionTrack | null) => void;
  segmenter: SubtitleSentenceSegmenter;
}

export async function loadYouTubeCaptionTracks(
  options: YouTubeCaptionTrackLoaderOptions,
): Promise<void> {
  const request = {
    expectedVideoId: options.expectedVideoId,
    generation: options.generation,
  };
  const source = await options.bridge.capture({ ...request, target: "source" });
  if (!options.isCurrent()) return;
  if (source === null || !/^en(?:-|$)/iu.test(source.track.languageCode)) {
    options.onSourceFailure();
    return;
  }
  const sentences = options.segmenter.segment(source.cues);
  if (sentences.length === 0) {
    options.onSourceFailure();
    return;
  }
  options.onSource(source, sentences);
  const translated = await options.bridge.capture({ ...request, target: "translated" });
  if (options.isCurrent()) options.onTranslated(translated);
}

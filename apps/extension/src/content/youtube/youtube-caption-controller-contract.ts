import type { OverlayPresentation } from "../overlay/overlay-controller.js";
import type { OverlayAnchorRect } from "../overlay/overlay-state.js";
import type { SelectionRequestInput } from "../selection/read-selection.js";
import type { SubtitleSentenceSegmenter } from "./subtitle-sentence-segmenter.js";
import type { YouTubeCaptionBridge } from "./youtube-caption-bridge-client.js";

export interface YouTubeCaptionSelectionEvent {
  anchorRect: OverlayAnchorRect;
  input: SelectionRequestInput;
  presentation: OverlayPresentation;
}

export interface YouTubeCaptionControllerOptions {
  bridge?: YouTubeCaptionBridge;
  canDismissSelection?: () => boolean;
  document?: Document;
  getVideoId?: () => string | null;
  isOverlayVisible?: () => boolean;
  isWatchPage?: () => boolean;
  onPresentationChange: () => void;
  onSelection: (event: YouTubeCaptionSelectionEvent) => void;
  onSessionClose: () => void;
  onWarmup: () => void;
  segmenter?: SubtitleSentenceSegmenter;
}

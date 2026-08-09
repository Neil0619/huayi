import { reduceYouTubeCaptionState, type YouTubeCaptionState } from "./youtube-caption-state.js";
import type { YouTubeCaptionSelectionEvent } from "./youtube-caption-controller-contract.js";
import type { YouTubeCaptionPresentation } from "./youtube-caption-presentation.js";
import { isNativeSubtitleSelectionRelease } from "./youtube-native-selection.js";

interface YouTubeCaptionSelectionControllerOptions {
  canReplace: () => boolean;
  getPlayer: () => HTMLElement | null;
  getState: () => YouTubeCaptionState;
  getVideo: () => HTMLVideoElement | null;
  onSelection: (event: YouTubeCaptionSelectionEvent) => void;
  onSelectionClose: () => void;
  onWarmup: () => void;
  setState: (state: YouTubeCaptionState) => void;
}

export class YouTubeCaptionSelectionController {
  constructor(
    private readonly documentRef: Document,
    private readonly presentation: YouTubeCaptionPresentation,
    private readonly options: YouTubeCaptionSelectionControllerOptions,
  ) {}

  readonly handleSelectionChange = (): void => {
    if (!this.options.canReplace()) return;
    const state = this.options.getState();
    const selection = this.readSelection(state);
    if (selection === null) return;
    let nextState = reduceYouTubeCaptionState(state, {
      selection: {
        endOffset: selection.endOffset,
        sentence: selection.sentence,
        startOffset: selection.startOffset,
      },
      type: "SELECT",
    });
    const video = this.options.getVideo();
    const player = this.options.getPlayer();
    if (video !== null && player !== null && !video.paused && !video.ended) {
      video.pause();
      nextState = reduceYouTubeCaptionState(nextState, {
        ownership: { generation: nextState.generation, player, video },
        type: "OWN_PAUSE",
      });
    }
    this.options.setState(nextState);
  };

  readonly handleMouseup = (event: MouseEvent): void => {
    const player = this.options.getPlayer();
    if (player === null || !isNativeSubtitleSelectionRelease(event, player)) return;
    if (!this.options.canReplace()) return;
    const selection = this.readSelection(this.options.getState());
    if (selection === null) return;
    event.stopImmediatePropagation();
    this.handleSelectionChange();
    this.options.onSelection({
      anchorRect: selection.anchorRect,
      input: selection.input,
      presentation: {
        dismissOnOutsidePointer: false,
        onClose: this.options.onSelectionClose,
        preferredSide: "above",
        resolveAnchorRect: () => selection.anchorRect,
        resolveMountTarget: () =>
          this.documentRef.fullscreenElement ?? this.documentRef.documentElement,
      },
    });
    this.options.onWarmup();
  };

  private readSelection(state: YouTubeCaptionState) {
    return this.presentation.readSelection(
      this.documentRef.defaultView?.getSelection() ?? null,
      state,
    );
  }
}

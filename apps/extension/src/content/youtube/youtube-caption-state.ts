import type { SubtitleSentence } from "./subtitle-sentence-segmenter.js";

export interface ActiveSubtitleSelection {
  endOffset: number;
  sentence: SubtitleSentence;
  startOffset: number;
}

export interface SubtitlePauseOwnership {
  generation: number;
  player: HTMLElement;
  video: HTMLVideoElement;
}

export interface YouTubeCaptionState {
  activeSelection: ActiveSubtitleSelection | null;
  generation: number;
  holdingShortcut: boolean;
  pauseOwnership: SubtitlePauseOwnership | null;
  pinnedBilingual: boolean;
  sourceTrackReady: boolean;
  translatedTrackReady: boolean;
}

export type YouTubeCaptionAction =
  | { generation: number; type: "NEW_GENERATION" }
  | { ready: boolean; type: "SOURCE_READY" }
  | { ready: boolean; type: "TRANSLATED_READY" }
  | { value: boolean; type: "HOLD_SHORTCUT" }
  | { type: "TOGGLE_PIN" }
  | { selection: ActiveSubtitleSelection; type: "SELECT" }
  | { type: "CLEAR_SELECTION" }
  | { ownership: SubtitlePauseOwnership; type: "OWN_PAUSE" }
  | { type: "REVOKE_PAUSE" };

export function initialYouTubeCaptionState(generation = 0): YouTubeCaptionState {
  return {
    activeSelection: null,
    generation,
    holdingShortcut: false,
    pauseOwnership: null,
    pinnedBilingual: false,
    sourceTrackReady: false,
    translatedTrackReady: false,
  };
}

export function reduceYouTubeCaptionState(
  state: YouTubeCaptionState,
  action: YouTubeCaptionAction,
): YouTubeCaptionState {
  switch (action.type) {
    case "NEW_GENERATION":
      return initialYouTubeCaptionState(action.generation);
    case "SOURCE_READY":
      return { ...state, sourceTrackReady: action.ready };
    case "TRANSLATED_READY":
      return {
        ...state,
        holdingShortcut: action.ready ? state.holdingShortcut : false,
        pinnedBilingual: action.ready ? state.pinnedBilingual : false,
        translatedTrackReady: action.ready,
      };
    case "HOLD_SHORTCUT":
      return { ...state, holdingShortcut: action.value };
    case "TOGGLE_PIN":
      return state.translatedTrackReady
        ? { ...state, pinnedBilingual: !state.pinnedBilingual }
        : state;
    case "SELECT":
      return { ...state, activeSelection: action.selection };
    case "CLEAR_SELECTION":
      return { ...state, activeSelection: null };
    case "OWN_PAUSE":
      return { ...state, pauseOwnership: action.ownership };
    case "REVOKE_PAUSE":
      return { ...state, pauseOwnership: null };
  }
}

export function shouldShowTranslation(state: YouTubeCaptionState): boolean {
  return state.translatedTrackReady && (state.pinnedBilingual || state.holdingShortcut);
}

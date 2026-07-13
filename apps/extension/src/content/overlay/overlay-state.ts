import type {
  AnalysisDeltaEvent,
  AnalysisDeltaSection,
  AnalysisError,
  AnalysisResult,
  AnalysisSectionEvent,
  AnalyzeAction,
  Collocation,
  ContextExample,
  CoreMeaning,
  PartOfSpeech,
  Pronunciation,
  RelatedTerm,
  WordbookAddOutcome,
  WordbookPresence,
} from "@huayi/protocol";

import type { SelectionRequestInput } from "../selection/read-selection.js";

export interface OverlayAnchorRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

export interface OverlayPoint {
  left: number;
  top: number;
}

interface OverlaySession {
  anchorRect: OverlayAnchorRect;
  position?: OverlayPoint;
  selection: SelectionRequestInput;
}

interface AnalysisOverlaySession extends OverlaySession {
  action: AnalyzeAction;
  startedAt: number;
  wordbook: WordbookUiState;
}

export interface AnalysisPreview {
  lastSequence: number;
  sections: AnalysisPreviewSections;
  text: Partial<Record<AnalysisDeltaSection, string>>;
}

export interface AnalysisPreviewSections {
  baseForm?: string;
  collocations?: Collocation[];
  contextExample?: ContextExample;
  coreMeanings?: CoreMeaning[];
  partOfSpeech?: PartOfSpeech;
  pronunciation?: Pronunciation;
  similarTerms?: RelatedTerm[];
  synonyms?: RelatedTerm[];
  wordFormation?: string;
}

export interface WordbookUiState {
  availability: "not-applicable" | "checking" | "absent" | "present" | "unknown";
  mutation:
    | { status: "idle" }
    | { status: "saving" }
    | { status: "success" }
    | { error: AnalysisError; status: "error" };
}

export interface IdleOverlayState {
  status: "idle";
}

export interface ActionsOverlayState extends OverlaySession {
  status: "actions";
}

export interface LoadingOverlayState extends AnalysisOverlaySession {
  status: "loading";
}

export interface StreamingOverlayState extends AnalysisOverlaySession {
  preview: AnalysisPreview;
  status: "streaming";
}

export interface ResultOverlayState extends AnalysisOverlaySession {
  result: AnalysisResult;
  status: "result";
}

export interface ErrorOverlayState extends AnalysisOverlaySession {
  error: AnalysisError;
  preview: AnalysisPreview;
  status: "error";
}

export interface ClosedOverlayState {
  status: "closed";
}

type AnalysisOverlayState =
  LoadingOverlayState | StreamingOverlayState | ResultOverlayState | ErrorOverlayState;
export type VisibleOverlayState = ActionsOverlayState | AnalysisOverlayState;
export type OverlayState = VisibleOverlayState | IdleOverlayState | ClosedOverlayState;

export type OverlayEvent =
  | ({ type: "SHOW_ACTIONS" } & Omit<OverlaySession, "position">)
  | { action: AnalyzeAction; startedAt: number; type: "START" }
  | {
      type: "APPEND_ANALYSIS_UPDATE";
      update: AnalysisDeltaEvent | AnalysisSectionEvent;
    }
  | { result: AnalysisResult; type: "RESOLVE" }
  | { error: AnalysisError; type: "REJECT" }
  | { presence: WordbookPresence; type: "RESOLVE_WORDBOOK_CHECK" }
  | { type: "REJECT_WORDBOOK_CHECK" }
  | { type: "START_WORDBOOK" }
  | { outcome: WordbookAddOutcome; type: "RESOLVE_WORDBOOK" }
  | { error: AnalysisError; type: "REJECT_WORDBOOK" }
  | { startedAt: number; type: "RETRY" }
  | { position: OverlayPoint; type: "MOVE" }
  | { type: "CLOSE" };

export function isVisibleOverlayState(state: OverlayState): state is VisibleOverlayState {
  return !["idle", "closed"].includes(state.status);
}

function hasAnalysis(state: OverlayState): state is AnalysisOverlayState {
  return ["loading", "streaming", "result", "error"].includes(state.status);
}

function initialWordbook(selection: SelectionRequestInput): WordbookUiState {
  return {
    availability: selection.selectionKind === "word" ? "checking" : "not-applicable",
    mutation: { status: "idle" },
  };
}

function emptyPreview(): AnalysisPreview {
  return { lastSequence: -1, sections: {}, text: {} };
}

function replacePreviewSection(
  sections: AnalysisPreviewSections,
  update: AnalysisSectionEvent,
): AnalysisPreviewSections {
  switch (update.section) {
    case "part-of-speech":
      return { ...sections, partOfSpeech: update.value };
    case "pronunciation":
      return { ...sections, pronunciation: update.value };
    case "base-form":
      return { ...sections, baseForm: update.value };
    case "word-formation":
      return { ...sections, wordFormation: update.value };
    case "core-meanings":
      return { ...sections, coreMeanings: update.value };
    case "collocations":
      return { ...sections, collocations: update.value };
    case "context-example":
      return { ...sections, contextExample: update.value };
    case "similar-terms":
      return { ...sections, similarTerms: update.value };
    case "synonyms":
      return { ...sections, synonyms: update.value };
  }
}

function toResultState(
  state: LoadingOverlayState | StreamingOverlayState,
  result: AnalysisResult,
): ResultOverlayState {
  const next: ResultOverlayState = {
    action: state.action,
    anchorRect: state.anchorRect,
    result,
    selection: state.selection,
    startedAt: state.startedAt,
    status: "result",
    wordbook: state.wordbook,
  };
  return state.position === undefined ? next : { ...next, position: state.position };
}

function toErrorState(
  state: LoadingOverlayState | StreamingOverlayState,
  error: AnalysisError,
): ErrorOverlayState {
  const next: ErrorOverlayState = {
    action: state.action,
    anchorRect: state.anchorRect,
    error,
    preview: state.status === "streaming" ? state.preview : emptyPreview(),
    selection: state.selection,
    startedAt: state.startedAt,
    status: "error",
    wordbook: state.wordbook,
  };
  return state.position === undefined ? next : { ...next, position: state.position };
}

function mayUpdateAvailability(state: AnalysisOverlayState): boolean {
  return (
    state.wordbook.availability !== "not-applicable" &&
    state.wordbook.mutation.status !== "saving" &&
    state.wordbook.mutation.status !== "success"
  );
}

export function reduceOverlayState(state: OverlayState, event: OverlayEvent): OverlayState {
  if (event.type === "SHOW_ACTIONS") {
    return {
      anchorRect: event.anchorRect,
      selection: event.selection,
      status: "actions",
    };
  }

  if (event.type === "CLOSE") {
    return { status: "closed" };
  }

  if (event.type === "MOVE") {
    return isVisibleOverlayState(state) ? { ...state, position: event.position } : state;
  }

  if (state.status === "actions" && event.type === "START") {
    return {
      ...state,
      action: event.action,
      startedAt: event.startedAt,
      status: "loading",
      wordbook: initialWordbook(state.selection),
    };
  }

  if (
    (state.status === "loading" || state.status === "streaming") &&
    event.type === "APPEND_ANALYSIS_UPDATE"
  ) {
    const preview = state.status === "streaming" ? state.preview : emptyPreview();
    if (event.update.sequence !== preview.lastSequence + 1) {
      return state;
    }
    const nextPreview: AnalysisPreview =
      event.update.type === "analysis-delta"
        ? {
            lastSequence: event.update.sequence,
            sections: preview.sections,
            text: {
              ...preview.text,
              [event.update.section]:
                `${preview.text[event.update.section] ?? ""}${event.update.delta}`,
            },
          }
        : {
            lastSequence: event.update.sequence,
            sections: replacePreviewSection(preview.sections, event.update),
            text: preview.text,
          };
    return {
      ...state,
      preview: nextPreview,
      status: "streaming",
    };
  }

  if ((state.status === "loading" || state.status === "streaming") && event.type === "RESOLVE") {
    return toResultState(state, event.result);
  }

  if ((state.status === "loading" || state.status === "streaming") && event.type === "REJECT") {
    return toErrorState(state, event.error);
  }

  if (state.status === "error" && state.error.retryable && event.type === "RETRY") {
    const loadingState: LoadingOverlayState = {
      action: state.action,
      anchorRect: state.anchorRect,
      selection: state.selection,
      startedAt: event.startedAt,
      status: "loading",
      wordbook: initialWordbook(state.selection),
    };
    return state.position === undefined
      ? loadingState
      : { ...loadingState, position: state.position };
  }

  if (
    hasAnalysis(state) &&
    mayUpdateAvailability(state) &&
    event.type === "RESOLVE_WORDBOOK_CHECK"
  ) {
    return { ...state, wordbook: { ...state.wordbook, availability: event.presence } };
  }

  if (
    hasAnalysis(state) &&
    mayUpdateAvailability(state) &&
    event.type === "REJECT_WORDBOOK_CHECK"
  ) {
    return { ...state, wordbook: { ...state.wordbook, availability: "unknown" } };
  }

  if (state.status === "result" && event.type === "START_WORDBOOK") {
    const isLexicalResult = ["explain-lexical", "translate-lexical"].includes(state.result.type);
    const mutation = state.wordbook.mutation;
    const mayStart =
      state.selection.selectionKind === "word" &&
      state.selection.wordbookContext !== null &&
      state.wordbook.availability !== "present" &&
      isLexicalResult &&
      mutation.status !== "saving" &&
      mutation.status !== "success" &&
      !(mutation.status === "error" && mutation.error.code === "RATE_LIMITED");
    return mayStart
      ? { ...state, wordbook: { ...state.wordbook, mutation: { status: "saving" } } }
      : state;
  }

  if (
    state.status === "result" &&
    state.wordbook.mutation.status === "saving" &&
    event.type === "RESOLVE_WORDBOOK"
  ) {
    return { ...state, wordbook: { ...state.wordbook, mutation: { status: "success" } } };
  }

  if (
    state.status === "result" &&
    state.wordbook.mutation.status === "saving" &&
    event.type === "REJECT_WORDBOOK"
  ) {
    return {
      ...state,
      wordbook: { ...state.wordbook, mutation: { error: event.error, status: "error" } },
    };
  }

  return state;
}

export class OverlayStateMachine {
  private currentState: OverlayState = { status: "idle" };

  get state(): OverlayState {
    return this.currentState;
  }

  dispatch(event: OverlayEvent): OverlayState {
    this.currentState = reduceOverlayState(this.currentState, event);
    return this.currentState;
  }
}

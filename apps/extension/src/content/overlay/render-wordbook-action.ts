import type {
  ErrorOverlayState,
  LoadingOverlayState,
  ResultOverlayState,
  StreamingOverlayState,
} from "./overlay-state.js";

type WordbookPanelState =
  LoadingOverlayState | StreamingOverlayState | ResultOverlayState | ErrorOverlayState;

export function canAddResultToWordbook(state: ResultOverlayState): boolean {
  return (
    state.selection.selectionKind === "word" &&
    state.selection.wordbookContext !== null &&
    state.result.selectionKind === "word" &&
    (state.result.type === "translate-word" || state.result.type === "explain-word")
  );
}

function isApplicableWordState(state: WordbookPanelState): boolean {
  if (state.selection.selectionKind !== "word") {
    return false;
  }
  return state.status !== "result" || state.result.selectionKind === "word";
}

function shouldRenderAction(state: WordbookPanelState): boolean {
  if (!isApplicableWordState(state)) {
    return false;
  }
  return (
    state.wordbook.availability === "present" ||
    (state.status === "result" && canAddResultToWordbook(state))
  );
}

function buttonLabel(state: WordbookPanelState): string {
  if (state.wordbook.mutation.status === "saving") {
    return "正在添加…";
  }
  if (state.wordbook.mutation.status === "success" || state.wordbook.availability === "present") {
    return "已加入生词本";
  }
  return "加入欧路生词本";
}

function isActionDisabled(state: WordbookPanelState): boolean {
  return (
    state.status !== "result" ||
    !canAddResultToWordbook(state) ||
    state.wordbook.availability === "present" ||
    state.wordbook.mutation.status === "saving" ||
    state.wordbook.mutation.status === "success" ||
    (state.wordbook.mutation.status === "error" &&
      state.wordbook.mutation.error.code === "RATE_LIMITED")
  );
}

export function renderWordbookAction(
  state: WordbookPanelState,
  onAddWord: () => void,
): HTMLElement | null {
  if (!shouldRenderAction(state)) {
    return null;
  }

  const container = document.createElement("section");
  container.className = "huayi-wordbook";
  container.tabIndex = -1;

  const button = document.createElement("button");
  button.className = "huayi-wordbook-button";
  button.dataset.action = "add-word";
  button.disabled = isActionDisabled(state);
  button.textContent = buttonLabel(state);
  button.type = "button";
  button.addEventListener("click", onAddWord);
  container.append(button);
  return container;
}

export function renderWordbookError(state: WordbookPanelState): HTMLElement | null {
  if (state.wordbook.mutation.status !== "error") {
    return null;
  }

  const error = document.createElement("p");
  error.className = "huayi-wordbook-error";
  error.setAttribute("aria-live", "polite");
  error.textContent = state.wordbook.mutation.error.message;
  return error;
}

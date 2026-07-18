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

function buttonText(state: WordbookPanelState): string {
  if (state.wordbook.mutation.status === "saving") {
    return "添加中";
  }
  if (state.wordbook.mutation.status === "success" || state.wordbook.availability === "present") {
    return "已加入";
  }
  return "生词";
}

function createWordbookIcon(document: Document): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.classList.add("huayi-wordbook-icon");
  icon.dataset.huayiIcon = "wordbook";
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("fill", "none");
  icon.setAttribute("viewBox", "0 0 20 20");

  const bookmark = document.createElementNS(namespace, "path");
  bookmark.setAttribute("d", "M5.75 3.25h8.5v13l-4.25-2.7-4.25 2.7v-13Z");
  bookmark.setAttribute("stroke", "currentColor");
  bookmark.setAttribute("stroke-linejoin", "round");
  bookmark.setAttribute("stroke-width", "1.5");

  const plus = document.createElementNS(namespace, "path");
  plus.setAttribute("d", "M10 6.25v4.5M7.75 8.5h4.5");
  plus.setAttribute("stroke", "currentColor");
  plus.setAttribute("stroke-linecap", "round");
  plus.setAttribute("stroke-width", "1.5");
  icon.append(bookmark, plus);
  return icon;
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
  button.setAttribute("aria-label", buttonLabel(state));
  button.append(createWordbookIcon(document));
  const label = document.createElement("span");
  label.textContent = buttonText(state);
  button.append(label);
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

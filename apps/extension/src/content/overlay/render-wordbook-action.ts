import type { ResultOverlayState } from "./overlay-state.js";

export function canAddResultToWordbook(state: ResultOverlayState): boolean {
  return (
    state.selection.selectionKind === "word" &&
    state.selection.wordbookContext !== null &&
    (state.result.type === "translate-lexical" || state.result.type === "explain-lexical")
  );
}

function buttonLabel(state: ResultOverlayState): string {
  switch (state.wordbook.mutation.status) {
    case "saving":
      return "正在添加…";
    case "success":
      return "已加入生词本";
    case "error":
    case "idle":
      return "加入欧路生词本";
  }
}

export function renderWordbookAction(
  state: ResultOverlayState,
  onAddWord: () => void,
): HTMLElement | null {
  if (!canAddResultToWordbook(state)) {
    return null;
  }

  const container = document.createElement("section");
  container.className = "huayi-wordbook";
  container.tabIndex = -1;

  const button = document.createElement("button");
  button.className = "huayi-wordbook-button";
  button.dataset.action = "add-word";
  button.disabled =
    state.wordbook.mutation.status === "saving" ||
    state.wordbook.mutation.status === "success" ||
    (state.wordbook.mutation.status === "error" &&
      state.wordbook.mutation.error.code === "RATE_LIMITED");
  button.textContent = buttonLabel(state);
  button.type = "button";
  button.addEventListener("click", onAddWord);
  container.append(button);

  if (state.wordbook.mutation.status === "error") {
    const error = document.createElement("p");
    error.className = "huayi-wordbook-error";
    error.setAttribute("aria-live", "polite");
    error.textContent = state.wordbook.mutation.error.message;
    container.append(error);
  }

  return container;
}

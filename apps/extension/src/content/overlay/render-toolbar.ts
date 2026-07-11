import { supportsAction } from "../selection/classify-selection.js";
import type { ActionsOverlayState } from "./overlay-state.js";

export interface ToolbarHandlers {
  onAction: (action: "translate" | "explain") => void;
}

function createActionButton(
  action: "translate" | "explain",
  label: string,
  icon: string,
  onAction: ToolbarHandlers["onAction"],
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "huayi-action";
  button.dataset.action = action;
  button.type = "button";

  const iconElement = document.createElement("span");
  iconElement.className = "huayi-action-icon";
  iconElement.setAttribute("aria-hidden", "true");
  iconElement.textContent = icon;

  const labelElement = document.createElement("span");
  labelElement.textContent = label;

  button.append(iconElement, labelElement);
  button.addEventListener("click", () => onAction(action));
  return button;
}

export function renderToolbar(state: ActionsOverlayState, handlers: ToolbarHandlers): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "huayi-root huayi-toolbar";
  toolbar.setAttribute("aria-label", "划译操作");
  toolbar.setAttribute("role", "toolbar");

  if (supportsAction(state.selection.selectionKind, "explain")) {
    toolbar.append(createActionButton("explain", "解释", "析", handlers.onAction));
  }

  toolbar.append(createActionButton("translate", "翻译", "译", handlers.onAction));
  return toolbar;
}

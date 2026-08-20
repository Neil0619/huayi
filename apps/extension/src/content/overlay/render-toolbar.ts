import { supportsAction } from "../selection/classify-selection.js";
import type { ActionsOverlayState } from "./overlay-state.js";

export interface ToolbarHandlers {
  onAction: (action: "translate" | "explain") => void;
}

function createActionButton(
  action: "translate" | "explain",
  label: string,
  icon: string,
  description: string,
  emphasis: "primary" | "secondary",
  onAction: ToolbarHandlers["onAction"],
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "huayi-action";
  button.dataset.action = action;
  button.dataset.emphasis = emphasis;
  button.type = "button";

  const iconElement = document.createElement("span");
  iconElement.className = "huayi-action-icon";
  iconElement.setAttribute("aria-hidden", "true");
  iconElement.textContent = icon;

  const copy = document.createElement("span");
  copy.className = "huayi-action-copy";

  const labelElement = document.createElement("strong");
  labelElement.className = "huayi-action-label";
  labelElement.textContent = label;

  const descriptionElement = document.createElement("small");
  descriptionElement.className = "huayi-action-description";
  descriptionElement.textContent = description;

  copy.append(labelElement, descriptionElement);
  button.append(iconElement, copy);
  button.addEventListener("click", () => onAction(action));
  return button;
}

function translationDescription(state: ActionsOverlayState): string {
  switch (state.selection.selectionKind) {
    case "word":
      return "查释义、词组与辨析";
    case "phrase":
      return "查看语境译义与搭配";
    case "sentence":
      return "翻译所选句子";
    case "paragraph":
      return "翻译所选段落";
  }
}

function explanationDescription(state: ActionsOverlayState): string {
  return state.selection.selectionKind === "sentence" ? "拆解句子结构与语境" : "结合原句理解用法";
}

export function renderToolbar(state: ActionsOverlayState, handlers: ToolbarHandlers): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "huayi-root huayi-toolbar";
  toolbar.setAttribute("aria-label", "语见操作");
  toolbar.setAttribute("role", "toolbar");

  const selectionHeader = document.createElement("header");
  selectionHeader.className = "huayi-toolbar-selection";
  const selectionLabel = document.createElement("span");
  selectionLabel.className = "huayi-toolbar-selection-label";
  selectionLabel.textContent = "已选择";
  const selectionText = document.createElement("strong");
  selectionText.className = "huayi-toolbar-selection-text";
  selectionText.textContent = state.selection.selection;
  selectionHeader.append(selectionLabel, selectionText);

  const actions = document.createElement("div");
  actions.className = "huayi-toolbar-actions";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "分析方式");

  const canExplain = supportsAction(state.selection.selectionKind, "explain");
  if (canExplain) {
    actions.append(
      createActionButton(
        "explain",
        "解释",
        "析",
        explanationDescription(state),
        "primary",
        handlers.onAction,
      ),
    );
  }

  actions.append(
    createActionButton(
      "translate",
      "翻译",
      "译",
      translationDescription(state),
      canExplain ? "secondary" : "primary",
      handlers.onAction,
    ),
  );
  toolbar.append(selectionHeader, actions);
  return toolbar;
}

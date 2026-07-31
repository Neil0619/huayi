import type { OverlayAnchorRect } from "../overlay/overlay-state.js";
import type { SelectionRequestInput } from "../selection/read-selection.js";
import {
  createCaptionSelection,
  segmentCaptionText,
  type CaptionTextSegment,
} from "./caption-selection.js";
import { youtubeControlStyles, youtubePickerStyles } from "./youtube-caption-styles.js";

export interface YouTubeControlView {
  button: HTMLButtonElement;
  host: HTMLDivElement;
  setState(enabled: boolean, active: boolean, busy?: boolean): void;
}

export interface CaptionPickerSelection {
  input: SelectionRequestInput;
  resolveAnchorRect: () => OverlayAnchorRect;
}

export type CaptionPickerCompleteness = "best-effort" | "complete";
export type CaptionPickerMode = "completing" | "ready";

export interface CaptionPickerView {
  host: HTMLDivElement;
  destroy(): void;
  setMode(
    mode: CaptionPickerMode,
    options?: { completeness?: CaptionPickerCompleteness; continueLabel?: string },
  ): void;
  updateText(text: string): void;
}

interface CaptionPickerOptions {
  captionText: string;
  completeness?: CaptionPickerCompleteness;
  continueLabel: string;
  document: Document;
  mode?: CaptionPickerMode;
  onClose: () => void;
  onSelection: (selection: CaptionPickerSelection) => void;
}

interface WordView {
  button: HTMLButtonElement;
  segment: CaptionTextSegment;
}

function createStyle(documentRef: Document, text: string): HTMLStyleElement {
  const style = documentRef.createElement("style");
  style.textContent = text;
  return style;
}

function pointAnchor(left: number, top: number): OverlayAnchorRect {
  return { bottom: top, height: 0, left, right: left, top, width: 0 };
}

function interactionAnchor(event: MouseEvent | PointerEvent, fallback: Element): OverlayAnchorRect {
  if (event.clientX !== 0 || event.clientY !== 0 || event.detail > 0) {
    return pointAnchor(event.clientX, event.clientY);
  }
  const rect = fallback.getBoundingClientRect();
  return pointAnchor(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

export function createYouTubeControlView(
  documentRef: Document,
  onActivate: () => void,
): YouTubeControlView {
  const host = documentRef.createElement("div");
  host.dataset.huayiOverlayHost = "";
  host.dataset.huayiYoutubeControlHost = "";
  const shadowRoot = host.attachShadow({ mode: "open" });
  const button = documentRef.createElement("button");
  button.type = "button";
  button.textContent = "译";
  button.title = "请先开启英文字幕";
  button.setAttribute("aria-label", "Huayi 字幕取词");
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-busy", "false");
  button.addEventListener("click", onActivate);
  shadowRoot.replaceChildren(createStyle(documentRef, youtubeControlStyles), button);

  return {
    button,
    host,
    setState: (enabled, active, busy = false) => {
      button.disabled = !enabled;
      button.textContent = busy ? "译…" : "译";
      button.title = active ? "关闭字幕取词" : enabled ? "Huayi 字幕取词" : "请先开启英文字幕";
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-busy", String(busy));
    },
  };
}

export function createCaptionPickerView(options: CaptionPickerOptions): CaptionPickerView {
  const { document: documentRef } = options;
  let captionText = options.captionText;
  let completeness = options.completeness ?? "complete";
  let continueLabel = options.continueLabel;
  let mode = options.mode ?? "ready";
  let wordViews: WordView[] = [];
  let dragStart = -1;
  let dragEnd = -1;
  let dragged = false;
  let suppressClick = false;

  const host = documentRef.createElement("div");
  host.dataset.huayiOverlayHost = "";
  host.dataset.huayiYoutubePickerHost = "";
  const shadowRoot = host.attachShadow({ mode: "open" });
  const picker = documentRef.createElement("section");
  picker.className = "huayi-caption-picker";
  picker.setAttribute("aria-label", "Huayi YouTube 字幕取词");
  picker.setAttribute("role", "dialog");

  const copy = documentRef.createElement("div");
  copy.className = "huayi-caption-copy";
  copy.setAttribute("aria-live", "polite");

  const highlight = (start: number, end: number): WordView[] => {
    const minimum = Math.min(start, end);
    const maximum = Math.max(start, end);
    const selected = wordViews.slice(minimum, maximum + 1);
    for (const [index, word] of wordViews.entries()) {
      word.button.dataset.selected = String(index >= minimum && index <= maximum);
    }
    return selected;
  };

  const emitRange = (start: number, end: number, anchorRect: OverlayAnchorRect): void => {
    if (mode !== "ready") {
      return;
    }
    const selected = highlight(start, end);
    const first = selected[0];
    const last = selected.at(-1);
    if (first === undefined || last === undefined) {
      return;
    }
    const input = createCaptionSelection(
      captionText.slice(first.segment.start, last.segment.end),
      captionText,
    );
    if (input !== null) {
      options.onSelection({ input, resolveAnchorRect: () => anchorRect });
    }
  };

  const renderCopy = (): void => {
    dragStart = -1;
    dragEnd = -1;
    dragged = false;
    suppressClick = false;
    wordViews = [];
    if (mode === "completing") {
      copy.textContent = captionText;
      return;
    }

    const nodes: Node[] = [];
    for (const segment of segmentCaptionText(captionText)) {
      if (!segment.isWordLike) {
        nodes.push(documentRef.createTextNode(segment.text));
        continue;
      }
      const button = documentRef.createElement("button");
      button.className = "huayi-caption-word";
      button.dataset.captionWord = "";
      button.type = "button";
      button.textContent = segment.text;
      const index = wordViews.length;
      button.addEventListener("pointerdown", (event) => {
        if (mode !== "ready" || event.button !== 0) {
          return;
        }
        event.preventDefault();
        dragStart = index;
        dragEnd = index;
        dragged = false;
        highlight(index, index);
      });
      button.addEventListener("pointerenter", () => {
        if (mode !== "ready" || dragStart < 0 || dragEnd === index) {
          return;
        }
        dragEnd = index;
        dragged = true;
        highlight(dragStart, dragEnd);
      });
      button.addEventListener("click", (event) => {
        if (mode !== "ready") {
          return;
        }
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        emitRange(index, index, interactionAnchor(event, button));
      });
      nodes.push(button);
      wordViews.push({ button, segment });
    }
    copy.replaceChildren(...nodes);
  };

  const handlePointerUp = (event: PointerEvent): void => {
    if (mode === "ready" && dragStart >= 0 && dragged) {
      emitRange(dragStart, dragEnd, interactionAnchor(event, wordViews[dragEnd]?.button ?? picker));
      suppressClick = true;
      queueMicrotask(() => {
        suppressClick = false;
      });
    }
    dragStart = -1;
    dragEnd = -1;
    dragged = false;
  };
  documentRef.addEventListener("pointerup", handlePointerUp, true);

  const close = documentRef.createElement("button");
  close.className = "huayi-caption-close";
  close.dataset.action = "close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "关闭字幕取词");
  close.addEventListener("click", options.onClose);

  const footer = documentRef.createElement("footer");
  footer.className = "huayi-caption-footer";
  const hint = documentRef.createElement("span");
  hint.dataset.captionStatus = "";
  const actions = documentRef.createElement("div");
  actions.className = "huayi-caption-actions";

  const selectCaption = documentRef.createElement("button");
  selectCaption.className = "huayi-caption-action";
  selectCaption.dataset.action = "select-caption";
  selectCaption.type = "button";
  selectCaption.addEventListener("click", (event) => {
    if (mode !== "ready") {
      return;
    }
    const input = createCaptionSelection(captionText, captionText);
    if (input === null) {
      return;
    }
    for (const word of wordViews) {
      word.button.dataset.selected = "true";
    }
    options.onSelection({
      input,
      resolveAnchorRect: () => interactionAnchor(event, selectCaption),
    });
  });

  const continueButton = documentRef.createElement("button");
  continueButton.className = "huayi-caption-action";
  continueButton.dataset.action = "continue";
  continueButton.dataset.primary = "true";
  continueButton.type = "button";
  continueButton.addEventListener("click", options.onClose);

  const renderMode = (): void => {
    const completing = mode === "completing";
    picker.setAttribute("aria-busy", String(completing));
    selectCaption.disabled = completing;
    selectCaption.textContent =
      completeness === "complete" && !completing ? "整句字幕" : "当前字幕";
    continueButton.textContent = completing ? "取消" : continueLabel;
    hint.textContent = completing
      ? "正在补全当前句…"
      : completeness === "complete"
        ? "点击单词，或按住鼠标拖选连续内容"
        : "未检测到完整句尾，已使用当前片段";
    renderCopy();
  };

  actions.append(selectCaption, continueButton);
  footer.append(hint, actions);
  picker.append(copy, close, footer);
  shadowRoot.replaceChildren(createStyle(documentRef, youtubePickerStyles), picker);
  renderMode();

  return {
    host,
    destroy: () => {
      documentRef.removeEventListener("pointerup", handlePointerUp, true);
      host.remove();
    },
    setMode: (nextMode, nextOptions = {}) => {
      mode = nextMode;
      completeness = nextOptions.completeness ?? completeness;
      continueLabel = nextOptions.continueLabel ?? continueLabel;
      renderMode();
    },
    updateText: (text) => {
      if (mode !== "completing") {
        return;
      }
      captionText = text;
      renderCopy();
    },
  };
}

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
  setState(enabled: boolean, active: boolean): void;
}

export interface CaptionPickerSelection {
  input: SelectionRequestInput;
  resolveAnchorRect: () => OverlayAnchorRect;
}

export interface CaptionPickerView {
  host: HTMLDivElement;
  destroy(): void;
}

interface CaptionPickerOptions {
  captionText: string;
  continueLabel: string;
  document: Document;
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
  button.addEventListener("click", onActivate);
  shadowRoot.replaceChildren(createStyle(documentRef, youtubeControlStyles), button);

  return {
    button,
    host,
    setState: (enabled, active) => {
      button.disabled = !enabled;
      button.title = active ? "关闭字幕取词" : enabled ? "Huayi 字幕取词" : "请先开启英文字幕";
      button.setAttribute("aria-pressed", String(active));
    },
  };
}

export function createCaptionPickerView(options: CaptionPickerOptions): CaptionPickerView {
  const { captionText, document: documentRef } = options;
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
  const wordViews: WordView[] = [];
  for (const segment of segmentCaptionText(captionText)) {
    if (!segment.isWordLike) {
      copy.append(documentRef.createTextNode(segment.text));
      continue;
    }
    const button = documentRef.createElement("button");
    button.className = "huayi-caption-word";
    button.dataset.captionWord = "";
    button.type = "button";
    button.textContent = segment.text;
    copy.append(button);
    wordViews.push({ button, segment });
  }

  let dragStart = -1;
  let dragEnd = -1;
  let dragged = false;
  let suppressClick = false;

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
    if (input === null) {
      return;
    }
    options.onSelection({
      input,
      resolveAnchorRect: () => anchorRect,
    });
  };

  for (const [index, word] of wordViews.entries()) {
    word.button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      dragStart = index;
      dragEnd = index;
      dragged = false;
      highlight(index, index);
    });
    word.button.addEventListener("pointerenter", () => {
      if (dragStart < 0 || dragEnd === index) {
        return;
      }
      dragEnd = index;
      dragged = true;
      highlight(dragStart, dragEnd);
    });
    word.button.addEventListener("click", (event) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      emitRange(index, index, interactionAnchor(event, word.button));
    });
  }

  const handlePointerUp = (event: PointerEvent): void => {
    if (dragStart >= 0 && dragged) {
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
  hint.textContent = "点击单词，或按住鼠标拖选连续内容";
  const actions = documentRef.createElement("div");
  actions.className = "huayi-caption-actions";

  const selectCaption = documentRef.createElement("button");
  selectCaption.className = "huayi-caption-action";
  selectCaption.dataset.action = "select-caption";
  selectCaption.type = "button";
  selectCaption.textContent = "整条字幕";
  selectCaption.addEventListener("click", (event) => {
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
  continueButton.textContent = options.continueLabel;
  continueButton.addEventListener("click", options.onClose);

  actions.append(selectCaption, continueButton);
  footer.append(hint, actions);
  picker.append(copy, close, footer);
  shadowRoot.replaceChildren(createStyle(documentRef, youtubePickerStyles), picker);

  return {
    host,
    destroy: () => {
      documentRef.removeEventListener("pointerup", handlePointerUp, true);
      host.remove();
    },
  };
}

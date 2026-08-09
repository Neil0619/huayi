import { isEnglishText, normalizeSelectionText } from "../selection/detect-english.js";
import { findSubtitleSentenceAt, type SubtitleSentence } from "./subtitle-sentence-segmenter.js";
import type { YouTubeCaptionState } from "./youtube-caption-state.js";

const EXCLUDED_BLANK_SELECTOR = [
  ".ytp-chrome-controls",
  ".ytp-popup",
  ".ytp-settings-menu",
  "[data-huayi-youtube-subtitle-surface]",
  "[data-huayi-youtube-control-host]",
  "[data-huayi-overlay-host]",
].join(",");
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

export function isUsableYouTubePlayer(player: HTMLElement, video: HTMLVideoElement): boolean {
  return (
    player.isConnected &&
    !player.classList.contains("ad-showing") &&
    !player.classList.contains("ytp-live") &&
    video.duration !== Number.POSITIVE_INFINITY &&
    !video.ended
  );
}

export function areYouTubeCaptionsEnabled(player: HTMLElement): boolean {
  return readYouTubeCaptionToggleState(player) === "on";
}

export function readYouTubeCaptionToggleState(player: HTMLElement): "off" | "on" | "unknown" {
  const button = player.querySelector<HTMLElement>(".ytp-subtitles-button");
  if (button === null) return "unknown";
  const pressed = button.getAttribute("aria-pressed");
  if (pressed === "true") return "on";
  if (pressed === "false") return "off";
  return player.querySelector(".ytp-caption-segment") === null ? "unknown" : "on";
}

export function readRawCaptionLanguage(player: HTMLElement): "empty" | "english" | "other" {
  const text = readRawCaptionText(player);
  if (text.length === 0) return "empty";
  return isEnglishText(text) ? "english" : "other";
}

export function readRawCaptionText(player: HTMLElement): string {
  return normalizeSelectionText(
    [...player.querySelectorAll(".ytp-caption-segment")]
      .map((element) => element.textContent ?? "")
      .join(" "),
  );
}

export function hasVisibleSourceMismatch(
  player: HTMLElement,
  video: HTMLVideoElement,
  sentences: readonly SubtitleSentence[],
  state: YouTubeCaptionState,
): boolean {
  if (!state.sourceTrackReady || state.activeSelection !== null) return false;
  const visibleText = readRawCaptionText(player);
  const sentence = findSubtitleSentenceAt(sentences, video.currentTime * 1_000);
  if (visibleText.length === 0 || sentence === null) return false;
  const visible = visibleText.toLocaleLowerCase("en-US");
  const expected = sentence.text.toLocaleLowerCase("en-US");
  return !expected.includes(visible) && !visible.includes(expected);
}

export function hasEditableFocus(documentRef: Document): boolean {
  return (
    documentRef.activeElement instanceof Element &&
    documentRef.activeElement.closest(EDITABLE_SELECTOR) !== null
  );
}

export function isPlayerBlankPointerTarget(event: Event, player: HTMLElement): boolean {
  return (
    event.target instanceof Element &&
    player.contains(event.target) &&
    event.target.closest(EXCLUDED_BLANK_SELECTOR) === null
  );
}

export function hasDocumentSelection(documentRef: Document): boolean {
  const selection = documentRef.defaultView?.getSelection();
  return selection !== undefined && selection !== null && !selection.isCollapsed;
}

export function isValidBridgePlayerState(
  player: HTMLElement | null,
  video: HTMLVideoElement | null,
  track: { languageCode: string },
  target: "source" | "translated",
): boolean | "retry" {
  if (
    player === null ||
    video === null ||
    !isUsableYouTubePlayer(player, video) ||
    !areYouTubeCaptionsEnabled(player) ||
    !/^en(?:-|$)/iu.test(track.languageCode)
  ) {
    return false;
  }
  const captionLanguage = readRawCaptionLanguage(player);
  if (captionLanguage !== "other") return true;
  return target === "translated" ? "retry" : false;
}

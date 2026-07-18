import { MAX_SELECTION_LENGTH } from "@huayi/protocol";

import { isEnglishText, normalizeSelectionText } from "../selection/detect-english.js";

export interface CaptionSnapshot {
  text: string;
}

interface UrlLocation {
  hostname: string;
  pathname: string;
}

interface VisibleCaptionSegment {
  left: number;
  text: string;
  top: number;
}

const CAPTION_SEGMENT_SELECTOR = ".ytp-caption-segment";
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

export function isYouTubeHost(location: Pick<UrlLocation, "hostname">): boolean {
  return YOUTUBE_HOSTS.has(location.hostname.toLowerCase());
}

export function isYouTubeWatchPage(location: UrlLocation): boolean {
  return isYouTubeHost(location) && location.pathname === "/watch";
}

function isVisible(element: Element): boolean {
  if (!element.isConnected) {
    return false;
  }
  const view = element.ownerDocument.defaultView;
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    const style = view?.getComputedStyle(current);
    if (
      current.getAttribute("aria-hidden") === "true" ||
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse" ||
      style?.opacity === "0"
    ) {
      return false;
    }
  }
  return [...element.getClientRects()].some((rect) => rect.width > 0 || rect.height > 0);
}

function compareVisualOrder(first: VisibleCaptionSegment, second: VisibleCaptionSegment): number {
  const lineDifference = first.top - second.top;
  return Math.abs(lineDifference) > 2 ? lineDifference : first.left - second.left;
}

export function readCurrentCaption(player: Element): CaptionSnapshot | null {
  const seen = new Set<string>();
  const segments: VisibleCaptionSegment[] = [];

  for (const element of player.querySelectorAll(CAPTION_SEGMENT_SELECTOR)) {
    if (!isVisible(element)) {
      continue;
    }
    const text = normalizeSelectionText(element.textContent ?? "");
    if (text.length === 0) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    const key = `${Math.round(rect.top)}:${Math.round(rect.left)}:${text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    segments.push({ left: rect.left, text, top: rect.top });
  }

  segments.sort(compareVisualOrder);
  const text = normalizeSelectionText(segments.map((segment) => segment.text).join(" "));
  if (text.length === 0 || text.length > MAX_SELECTION_LENGTH || !isEnglishText(text)) {
    return null;
  }
  return { text };
}

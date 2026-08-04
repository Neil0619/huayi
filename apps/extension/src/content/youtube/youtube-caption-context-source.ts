import { MAX_CONTEXT_LENGTH } from "@huayi/protocol";

import { isEnglishText } from "../selection/detect-english.js";
import { readCurrentCaption } from "./caption-reader.js";
import type { CaptionSnapshot } from "./caption-reader.js";
import {
  loadYouTubeCaptionTranscript,
  type CaptionTranscriptFetch,
  type TimedCaptionCue,
} from "./youtube-caption-transcript.js";
import {
  mergeCaptionText,
  normalizedCaptionText,
  sentenceAround,
  sentenceFromTranscript,
} from "./youtube-caption-text.js";

interface YouTubeCaptionContextSourceOptions {
  loadTranscript?: (
    documentRef: Document,
    signal: AbortSignal,
  ) => Promise<TimedCaptionCue[] | null>;
  prefetchTimeoutMs?: number;
}

export interface YouTubeCaptionContext {
  attach(player: HTMLElement, video: HTMLVideoElement, onAvailabilityChange: () => void): void;
  clear(): void;
  freeze(): CaptionSnapshot | null;
}

interface ObservedCaption {
  text: string;
  timeSeconds: number;
}

interface TextTrackEventSource {
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

const BUFFER_WINDOW_SECONDS = 30;
const PREFETCH_TIMEOUT_MS = 3_000;

function textTrackEventSource(video: HTMLVideoElement): TextTrackEventSource | null {
  const candidate = video.textTracks as unknown;
  return typeof candidate === "object" &&
    candidate !== null &&
    "addEventListener" in candidate &&
    typeof candidate.addEventListener === "function" &&
    "removeEventListener" in candidate &&
    typeof candidate.removeEventListener === "function"
    ? (candidate as TextTrackEventSource)
    : null;
}

export class YouTubeCaptionContextSource implements YouTubeCaptionContext {
  private abortController: AbortController | null = null;
  private availability = false;
  private captionTrackFingerprint: string | null = null;
  private generation = 0;
  private readonly loadTranscript: NonNullable<
    YouTubeCaptionContextSourceOptions["loadTranscript"]
  >;
  private observer: MutationObserver | null = null;
  private onAvailabilityChange: (() => void) | null = null;
  private player: HTMLElement | null = null;
  private readonly prefetchTimeoutMs: number;
  private rolling: ObservedCaption[] = [];
  private transcript: TimedCaptionCue[] | null = null;
  private transcriptRequested = false;
  private textTrackEvents: TextTrackEventSource | null = null;
  private video: HTMLVideoElement | null = null;

  constructor(options: YouTubeCaptionContextSourceOptions = {}) {
    this.loadTranscript =
      options.loadTranscript ??
      ((documentRef, signal) => this.loadDefaultTranscript(documentRef, signal));
    this.prefetchTimeoutMs = options.prefetchTimeoutMs ?? PREFETCH_TIMEOUT_MS;
  }

  attach(player: HTMLElement, video: HTMLVideoElement, onAvailabilityChange: () => void): void {
    if (this.player === player && this.video === video) {
      return;
    }
    this.clear();
    this.player = player;
    this.video = video;
    this.onAvailabilityChange = onAvailabilityChange;
    this.observer = new MutationObserver(() => this.observeCurrentCaption());
    this.observer.observe(player, {
      attributeFilter: [
        "aria-hidden",
        "class",
        "data-caption-track",
        "data-language-code",
        "data-track-id",
        "lang",
        "style",
      ],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    video.addEventListener("seeking", this.handleSeeking);
    this.textTrackEvents = textTrackEventSource(video);
    this.textTrackEvents?.addEventListener("change", this.handleCaptionTrackChange);
    this.observeCurrentCaption();
  }

  freeze(): CaptionSnapshot | null {
    const current = this.observeCurrentCaption();
    if (current === null || this.video === null) {
      return null;
    }
    const transcript = this.transcriptContext(current, this.video.currentTime * 1_000);
    if (transcript !== null) {
      return { text: transcript };
    }
    return { text: this.rollingContext(current) ?? current.text };
  }

  clear(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.observer?.disconnect();
    this.observer = null;
    this.video?.removeEventListener("seeking", this.handleSeeking);
    this.textTrackEvents?.removeEventListener("change", this.handleCaptionTrackChange);
    this.textTrackEvents = null;
    this.video = null;
    this.player = null;
    this.onAvailabilityChange = null;
    this.rolling = [];
    this.transcript = null;
    this.transcriptRequested = false;
    this.captionTrackFingerprint = null;
    this.availability = false;
  }

  private readonly handleSeeking = (): void => {
    this.rolling = [];
  };

  private readonly handleCaptionTrackChange = (): void => {
    this.resetCaptionState();
    this.captionTrackFingerprint = this.readCaptionTrackFingerprint();
  };

  private observeCurrentCaption(): CaptionSnapshot | null {
    const snapshot = this.player === null ? null : readCurrentCaption(this.player);
    const nextFingerprint = this.readCaptionTrackFingerprint();
    if (
      nextFingerprint !== null &&
      this.captionTrackFingerprint !== null &&
      nextFingerprint !== this.captionTrackFingerprint
    ) {
      this.resetCaptionState();
    }
    if (nextFingerprint !== null) {
      this.captionTrackFingerprint = nextFingerprint;
    }
    if (snapshot === null && this.hasVisibleForeignCaption()) {
      this.resetCaptionState();
    }
    const available = snapshot !== null;
    if (available !== this.availability) {
      this.availability = available;
      this.onAvailabilityChange?.();
    }
    if (snapshot !== null && this.video !== null) {
      if (
        this.transcript !== null &&
        this.transcriptContext(snapshot, this.video.currentTime * 1_000) === null
      ) {
        this.resetCaptionState();
      }
      this.record(snapshot.text, this.video.currentTime);
      if (!this.transcriptRequested) {
        this.transcriptRequested = true;
        this.prefetchTranscript();
      }
    }
    return snapshot;
  }

  private readCaptionTrackFingerprint(): string | null {
    if (this.player === null) return null;
    const segment = this.player.querySelector<HTMLElement>(".ytp-caption-segment");
    for (
      let element: HTMLElement | null = segment;
      element !== null;
      element = element.parentElement
    ) {
      const attributes = [
        element.getAttribute("lang"),
        element.getAttribute("data-language-code"),
        element.getAttribute("data-track-id"),
        element.getAttribute("data-caption-track"),
      ].filter((value): value is string => value !== null && value.length > 0);
      if (attributes.length > 0) {
        return attributes.join("\u0000");
      }
      if (element === this.player) break;
    }
    return null;
  }

  private hasVisibleForeignCaption(): boolean {
    if (this.player === null) return false;
    for (const element of this.player.querySelectorAll(".ytp-caption-segment")) {
      const text = normalizedCaptionText(element.textContent ?? "");
      if (
        text.length > 0 &&
        element.isConnected &&
        [...element.getClientRects()].some((rect) => rect.width > 0 || rect.height > 0) &&
        !isEnglishText(text)
      ) {
        return true;
      }
    }
    return false;
  }

  private resetCaptionState(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.rolling = [];
    this.transcript = null;
    this.transcriptRequested = false;
  }

  private record(text: string, timeSeconds: number): void {
    const normalized = normalizedCaptionText(text);
    if (normalized.length === 0) return;
    const time = Number.isFinite(timeSeconds) && timeSeconds >= 0 ? timeSeconds : 0;
    const last = this.rolling.at(-1);
    if (last?.text === normalized) {
      last.timeSeconds = time;
    } else if (last !== undefined && normalized.startsWith(last.text)) {
      last.text = normalized;
      last.timeSeconds = time;
    } else if (last !== undefined && last.text.startsWith(normalized)) {
      last.timeSeconds = time;
    } else {
      this.rolling.push({ text: normalized, timeSeconds: time });
    }
    const minimumTime = time - BUFFER_WINDOW_SECONDS;
    this.rolling = this.rolling.filter((entry) => entry.timeSeconds >= minimumTime);
    while (this.rolling.length > 1 && this.mergedRollingText().length > MAX_CONTEXT_LENGTH) {
      this.rolling.shift();
    }
  }

  private mergedRollingText(): string {
    return this.rolling.reduce((merged, entry) => mergeCaptionText(merged, entry.text), "");
  }

  private rollingContext(current: CaptionSnapshot): string | null {
    const merged = this.mergedRollingText();
    return sentenceAround(merged, current.text, merged.length);
  }

  private transcriptContext(current: CaptionSnapshot, timeMs: number): string | null {
    return this.transcript === null
      ? null
      : sentenceFromTranscript(this.transcript, current, timeMs);
  }

  private loadDefaultTranscript(
    documentRef: Document,
    signal: AbortSignal,
  ): Promise<TimedCaptionCue[] | null> {
    const fetchImpl = globalThis.fetch as CaptionTranscriptFetch | undefined;
    if (fetchImpl === undefined) return Promise.resolve(null);
    return loadYouTubeCaptionTranscript(documentRef, fetchImpl.bind(globalThis), signal, (cues) => {
      const current = this.player === null ? null : readCurrentCaption(this.player);
      return (
        current !== null &&
        this.video !== null &&
        sentenceFromTranscript(cues, current, this.video.currentTime * 1_000) !== null
      );
    });
  }

  private prefetchTranscript(): void {
    if (this.player === null) return;
    const documentRef = this.player.ownerDocument;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.abortController = controller;
    const timeout = globalThis.setTimeout(() => controller.abort(), this.prefetchTimeoutMs);
    void this.loadTranscript(documentRef, controller.signal)
      .then((transcript) => {
        if (this.generation === generation && !controller.signal.aborted) {
          const current = this.player === null ? null : readCurrentCaption(this.player);
          this.transcript =
            transcript !== null &&
            current !== null &&
            this.video !== null &&
            sentenceFromTranscript(transcript, current, this.video.currentTime * 1_000) !== null
              ? transcript
              : null;
          this.onAvailabilityChange?.();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        globalThis.clearTimeout(timeout);
        if (this.abortController === controller) this.abortController = null;
      });
  }
}

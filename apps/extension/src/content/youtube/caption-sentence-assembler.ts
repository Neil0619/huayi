import { MAX_CONTEXT_LENGTH } from "@huayi/protocol";

import { normalizeSelectionText } from "../selection/detect-english.js";
import {
  commonPrefixLength,
  createDefaultSentenceSegmenter,
  firstSentence,
  isTrustedPrefix,
  lastSentence,
  longestSuffixPrefixOverlap,
  type SentenceSegmenter,
} from "./caption-sentence-boundaries.js";

export interface CaptionObservation {
  observedAtMs: number;
  text: string;
}

export interface CaptionCapture {
  captureId: number;
  complete: boolean;
  startedAtMs: number;
  text: string;
}

export interface CaptionCaptureResult {
  completeness: "best-effort" | "complete";
  text: string;
}

export interface CaptionAssemblySnapshot {
  complete: boolean;
  overflow: boolean;
  text: string;
}

interface CaptionSentenceAssemblerOptions {
  discontinuityGapMs?: number;
  historyMaxAgeMs?: number;
  historyMaxObservations?: number;
  sentenceSegmenter?: SentenceSegmenter | null;
}

interface ActiveCapture {
  captureId: number;
  complete: boolean;
  overflow: boolean;
  text: string;
}

const DEFAULT_DISCONTINUITY_GAP_MS = 4_000;
const DEFAULT_HISTORY_MAX_AGE_MS = 20_000;
const DEFAULT_HISTORY_MAX_OBSERVATIONS = 16;

export class CaptionSentenceAssembler {
  private readonly discontinuityGapMs: number;
  private readonly historyMaxAgeMs: number;
  private readonly historyMaxObservations: number;
  private readonly sentenceSegmenter: SentenceSegmenter | null;
  private acceptedObservations = 0;
  private activeCapture: ActiveCapture | null = null;
  private captureSequence = 0;
  private current: CaptionAssemblySnapshot = { complete: false, overflow: false, text: "" };
  private currentStartedAtMs: number | null = null;
  private lastObservation: CaptionObservation | null = null;
  private pendingBaseline: CaptionObservation | null = null;
  private rollbackBaseText: string | null = null;

  constructor(options: CaptionSentenceAssemblerOptions = {}) {
    this.discontinuityGapMs = options.discontinuityGapMs ?? DEFAULT_DISCONTINUITY_GAP_MS;
    this.historyMaxAgeMs = options.historyMaxAgeMs ?? DEFAULT_HISTORY_MAX_AGE_MS;
    this.historyMaxObservations =
      options.historyMaxObservations ?? DEFAULT_HISTORY_MAX_OBSERVATIONS;
    this.sentenceSegmenter =
      options.sentenceSegmenter === undefined
        ? createDefaultSentenceSegmenter()
        : options.sentenceSegmenter;
  }

  observe(observation: CaptionObservation): CaptionAssemblySnapshot {
    const text = normalizeSelectionText(observation.text);
    if (text.length === 0) {
      return this.snapshot();
    }

    const previous = this.lastObservation;
    const normalizedObservation = { observedAtMs: observation.observedAtMs, text };
    const expired =
      this.currentStartedAtMs !== null &&
      observation.observedAtMs - this.currentStartedAtMs > this.historyMaxAgeMs;
    if (expired) {
      if (this.activeCapture !== null) {
        this.activeCapture.overflow = true;
        this.pendingBaseline = normalizedObservation;
      } else {
        this.replaceCurrent(text, observation.observedAtMs);
      }
      this.lastObservation = normalizedObservation;
      this.acceptedObservations = 1;
      return this.snapshot();
    }
    if (previous?.text === text) {
      return this.snapshot();
    }
    if (previous !== null && previous.text.startsWith(text)) {
      this.rollbackBaseText = this.current.text.endsWith(previous.text)
        ? `${this.current.text.slice(0, -previous.text.length)}${text}`
        : lastSentence(text, this.sentenceSegmenter).text;
      this.lastObservation = normalizedObservation;
      return this.snapshot();
    }

    const gapMs =
      previous === null ? 0 : Math.max(0, observation.observedAtMs - previous.observedAtMs);
    const discontinuity = gapMs > this.discontinuityGapMs || text.includes(">>");
    if (previous === null || discontinuity) {
      this.replaceCurrent(text, observation.observedAtMs);
    } else if (this.acceptedObservations >= this.historyMaxObservations) {
      if (this.activeCapture !== null) {
        this.activeCapture.overflow = true;
        this.pendingBaseline = normalizedObservation;
      } else {
        this.replaceCurrent(text, observation.observedAtMs);
      }
    } else {
      this.mergeObservation(previous.text, text, observation.observedAtMs);
      if (this.snapshot().overflow) {
        if (this.activeCapture !== null) {
          this.pendingBaseline = normalizedObservation;
        } else {
          this.replaceCurrent(text, observation.observedAtMs);
        }
      }
    }

    this.lastObservation = normalizedObservation;
    this.acceptedObservations += 1;
    return this.snapshot();
  }

  beginCapture(startedAtMs: number): CaptionCapture | null {
    if (this.current.text.length === 0 || this.activeCapture !== null) {
      return null;
    }
    const captureId = (this.captureSequence += 1);
    this.activeCapture = {
      captureId,
      complete: this.current.complete,
      overflow: this.current.overflow,
      text: this.current.text,
    };
    return {
      captureId,
      complete: this.current.complete,
      startedAtMs,
      text: this.current.text,
    };
  }

  resolveCapture(
    capture: CaptionCapture,
    reason: "boundary" | "overflow" | "playback-stopped" | "timeout",
  ): CaptionCaptureResult | null {
    if (this.activeCapture?.captureId !== capture.captureId) {
      return null;
    }
    const active = this.activeCapture;
    this.activeCapture = null;
    const result: CaptionCaptureResult = {
      completeness:
        reason === "boundary" && active.complete && !active.overflow ? "complete" : "best-effort",
      text: active.text,
    };
    this.restorePendingBaseline();
    return result;
  }

  cancelCapture(capture: CaptionCapture): void {
    if (this.activeCapture?.captureId === capture.captureId) {
      this.activeCapture = null;
      this.restorePendingBaseline();
    }
  }

  clear(): void {
    this.acceptedObservations = 0;
    this.activeCapture = null;
    this.current = { complete: false, overflow: false, text: "" };
    this.currentStartedAtMs = null;
    this.lastObservation = null;
    this.pendingBaseline = null;
    this.rollbackBaseText = null;
  }

  private mergeObservation(previousText: string, nextText: string, observedAtMs: number): void {
    const baseText = this.rollbackBaseText ?? this.current.text;
    let candidate: string;
    if (nextText.startsWith(previousText)) {
      candidate = `${baseText}${nextText.slice(previousText.length)}`;
    } else {
      const overlap = longestSuffixPrefixOverlap(previousText, nextText);
      const prefixLength = commonPrefixLength(previousText, nextText);
      if (overlap > 0) {
        candidate = `${baseText}${nextText.slice(overlap)}`;
      } else if (isTrustedPrefix(nextText.slice(0, prefixLength))) {
        candidate = this.replaceObservationTail(baseText, previousText, nextText);
      } else if (this.current.complete) {
        candidate = nextText;
      } else {
        candidate = `${baseText} ${nextText}`;
      }
    }
    this.rollbackBaseText = null;
    this.acceptCandidate(candidate, observedAtMs);
  }

  private replaceObservationTail(baseText: string, previousText: string, nextText: string): string {
    return baseText.endsWith(previousText)
      ? `${baseText.slice(0, -previousText.length)}${nextText}`
      : nextText;
  }

  private acceptCandidate(candidate: string, observedAtMs: number): void {
    const normalized = normalizeSelectionText(candidate);
    if (normalized.length > MAX_CONTEXT_LENGTH) {
      this.current = { ...this.current, overflow: true };
      if (this.activeCapture !== null) {
        this.activeCapture.overflow = true;
      }
      return;
    }

    if (this.activeCapture !== null) {
      const target = firstSentence(normalized, this.sentenceSegmenter);
      this.activeCapture = { ...this.activeCapture, ...target };
      this.current = target;
      const trailingText = target.complete
        ? normalizeSelectionText(normalized.slice(target.text.length))
        : "";
      if (trailingText.length > 0) {
        this.pendingBaseline = {
          observedAtMs,
          text: lastSentence(trailingText, this.sentenceSegmenter).text,
        };
      }
      return;
    }
    const target = lastSentence(normalized, this.sentenceSegmenter);
    if (this.current.complete || target.text !== normalized) {
      this.currentStartedAtMs = observedAtMs;
    }
    this.current = target;
  }

  private replaceCurrent(text: string, observedAtMs: number): void {
    const target = lastSentence(text, this.sentenceSegmenter);
    this.current = target;
    this.currentStartedAtMs = observedAtMs;
    this.acceptedObservations = 0;
    this.pendingBaseline = null;
    this.rollbackBaseText = null;
    if (this.activeCapture !== null) {
      this.activeCapture.complete = true;
    }
  }

  private restorePendingBaseline(): void {
    const pending = this.pendingBaseline;
    if (pending === null) {
      return;
    }
    this.pendingBaseline = null;
    this.replaceCurrent(pending.text, pending.observedAtMs);
    this.lastObservation = pending;
    this.acceptedObservations = 1;
  }

  private snapshot(): CaptionAssemblySnapshot {
    if (this.activeCapture !== null) {
      return {
        complete: this.activeCapture.complete,
        overflow: this.activeCapture.overflow,
        text: this.activeCapture.text,
      };
    }
    return { ...this.current };
  }
}

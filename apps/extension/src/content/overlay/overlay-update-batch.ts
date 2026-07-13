import type { AnalysisDeltaEvent, AnalysisSectionEvent } from "@huayi/protocol";

export type OverlayAnalysisUpdate = AnalysisDeltaEvent | AnalysisSectionEvent;

export class OverlayUpdateBatch {
  private readonly onFlush: (events: OverlayAnalysisUpdate[]) => void;
  private readonly waitMs: number;
  private pending: OverlayAnalysisUpdate[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(onFlush: (events: OverlayAnalysisUpdate[]) => void, waitMs = 40) {
    this.onFlush = onFlush;
    this.waitMs = waitMs;
  }

  append(event: OverlayAnalysisUpdate): void {
    this.pending.push(event);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.waitMs);
    }
  }

  clear(): void {
    this.clearTimer();
    this.pending = [];
  }

  drain(): OverlayAnalysisUpdate[] {
    this.clearTimer();
    const events = this.pending;
    this.pending = [];
    return events;
  }

  flush(): void {
    const events = this.drain();
    if (events.length > 0) {
      this.onFlush(events);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

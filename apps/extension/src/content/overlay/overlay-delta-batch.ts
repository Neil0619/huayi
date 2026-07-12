import type { AnalysisDeltaEvent } from "@huayi/protocol";

export type PendingAnalysisDelta = Pick<AnalysisDeltaEvent, "delta" | "section" | "sequence">;

export class OverlayDeltaBatch {
  private readonly onFlush: (events: PendingAnalysisDelta[]) => void;
  private readonly waitMs: number;
  private pending: PendingAnalysisDelta[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(onFlush: (events: PendingAnalysisDelta[]) => void, waitMs = 40) {
    this.onFlush = onFlush;
    this.waitMs = waitMs;
  }

  append(event: PendingAnalysisDelta): void {
    this.pending.push(event);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.waitMs);
    }
  }

  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = [];
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.length === 0) {
      return;
    }
    const events = this.pending;
    this.pending = [];
    this.onFlush(events);
  }
}

import type { AnalysisDeltaEvent, AnalysisSectionEvent } from "@huayi/protocol";

import type { FrameScheduler } from "./frame-scheduler.js";

export type OverlayAnalysisUpdate = AnalysisDeltaEvent | AnalysisSectionEvent;

export class OverlayUpdateBatch {
  private readonly onFlush: (events: OverlayAnalysisUpdate[]) => void;
  private readonly scheduler: FrameScheduler;
  private generation = 0;
  private pending: OverlayAnalysisUpdate[] = [];
  private scheduledHandle: number | null = null;

  constructor(onFlush: (events: OverlayAnalysisUpdate[]) => void, scheduler: FrameScheduler) {
    this.onFlush = onFlush;
    this.scheduler = scheduler;
  }

  append(event: OverlayAnalysisUpdate): void {
    this.pending.push(event);
    if (this.scheduledHandle === null) {
      const generation = this.generation;
      this.scheduledHandle = this.scheduler.request(() => this.flushScheduled(generation));
    }
  }

  clear(): void {
    this.cancelScheduled();
    this.pending = [];
  }

  drain(): OverlayAnalysisUpdate[] {
    this.cancelScheduled();
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

  private cancelScheduled(): void {
    this.generation += 1;
    if (this.scheduledHandle !== null) {
      this.scheduler.cancel(this.scheduledHandle);
      this.scheduledHandle = null;
    }
  }

  private flushScheduled(generation: number): void {
    if (generation !== this.generation) {
      return;
    }
    this.scheduledHandle = null;
    this.flush();
  }
}

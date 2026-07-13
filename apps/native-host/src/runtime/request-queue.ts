export type CancellationState = "pending" | "running";
export type QueueTask = (signal: AbortSignal) => Promise<void>;

interface QueueItem {
  controller: AbortController;
  requestId: string;
  task: QueueTask;
  terminal: boolean;
}

export class RequestQueue {
  private readonly active = new Map<string, QueueItem>();
  private readonly maximumConcurrency: number;
  private readonly pending: QueueItem[] = [];

  constructor(maximumConcurrency = 2) {
    if (!Number.isInteger(maximumConcurrency) || maximumConcurrency < 1) {
      throw new RangeError("Queue concurrency must be a positive integer.");
    }
    this.maximumConcurrency = maximumConcurrency;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue(requestId: string, task: QueueTask): void {
    if (this.active.has(requestId) || this.pending.some((item) => item.requestId === requestId)) {
      throw new Error(`Duplicate request ID: ${requestId}`);
    }

    this.pending.push({ controller: new AbortController(), requestId, task, terminal: false });
    this.pump();
  }

  markTerminal(requestId: string): boolean {
    const item = this.active.get(requestId);
    if (item === undefined || item.controller.signal.aborted || item.terminal) return false;
    item.terminal = true;
    return true;
  }

  cancel(requestId: string): CancellationState | null {
    const pendingIndex = this.pending.findIndex((item) => item.requestId === requestId);
    if (pendingIndex >= 0) {
      const [item] = this.pending.splice(pendingIndex, 1);
      item?.controller.abort();
      return "pending";
    }

    const activeItem = this.active.get(requestId);
    if (activeItem === undefined || activeItem.terminal) {
      return null;
    }
    if (activeItem.controller.signal.aborted) {
      return null;
    }
    activeItem.controller.abort();
    return "running";
  }

  dispose(): void {
    for (const item of this.pending) {
      item.controller.abort();
    }
    for (const item of this.active.values()) {
      item.controller.abort();
    }
    this.pending.length = 0;
    this.active.clear();
  }

  private pump(): void {
    while (this.active.size < this.maximumConcurrency && this.pending.length > 0) {
      const item = this.pending.shift();
      if (item === undefined) {
        return;
      }

      this.active.set(item.requestId, item);
      let taskResult: Promise<void>;
      try {
        taskResult = item.task(item.controller.signal);
      } catch {
        taskResult = Promise.resolve();
      }

      void taskResult
        .catch(() => undefined)
        .finally(() => {
          this.active.delete(item.requestId);
          this.pump();
        });
    }
  }
}

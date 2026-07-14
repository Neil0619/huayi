import type { FrameScheduler } from "./frame-scheduler.js";

export class FakeFrameScheduler implements FrameScheduler {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, () => void>();

  get pendingCount(): number {
    return this.callbacks.size;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  request(callback: () => void): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  runFrame(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback());
  }
}

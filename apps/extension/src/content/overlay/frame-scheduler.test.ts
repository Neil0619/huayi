import { describe, expect, it, vi } from "vitest";

import type { AnalysisDeltaEvent } from "@huayi/protocol";

import { createFrameScheduler, type FrameScheduler } from "./frame-scheduler.js";
import { OverlayUpdateBatch } from "./overlay-update-batch.js";

class FakeFrameScheduler implements FrameScheduler {
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
    for (const callback of callbacks) {
      callback();
    }
  }
}

function delta(sequence: number): AnalysisDeltaEvent {
  return {
    delta: String(sequence),
    requestId: "analysis-1",
    schemaVersion: 3,
    section: "translation",
    sequence,
    type: "analysis-delta",
  };
}

describe("OverlayUpdateBatch", () => {
  it("coalesces many appends into one flush per frame", () => {
    const scheduler = new FakeFrameScheduler();
    const onFlush = vi.fn();
    const batch = new OverlayUpdateBatch(onFlush, scheduler);
    const events = Array.from({ length: 10 }, (_, index) => delta(index));

    for (const event of events) {
      batch.append(event);
    }

    expect(scheduler.pendingCount).toBe(1);
    scheduler.runFrame();
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith(events);
  });

  it("schedules appends made during a flush for the next frame", () => {
    const scheduler = new FakeFrameScheduler();
    const second = delta(1);
    const onFlush = vi.fn(() => batch.append(second));
    const batch = new OverlayUpdateBatch(onFlush, scheduler);

    batch.append(delta(0));
    scheduler.runFrame();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingCount).toBe(1);
    scheduler.runFrame();
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenLastCalledWith([second]);
  });

  it("drains pending events while clear discards them", () => {
    const scheduler = new FakeFrameScheduler();
    const onFlush = vi.fn();
    const batch = new OverlayUpdateBatch(onFlush, scheduler);
    const pending = [delta(0), delta(1)];

    pending.forEach((event) => batch.append(event));
    expect(batch.drain()).toEqual(pending);
    expect(scheduler.pendingCount).toBe(0);

    batch.append(delta(2));
    batch.clear();
    scheduler.runFrame();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("ignores a stale callback after clear even when cancellation loses the race", () => {
    let staleCallback: (() => void) | undefined;
    const scheduler: FrameScheduler = {
      cancel: () => undefined,
      request: (callback) => {
        staleCallback = callback;
        return 1;
      },
    };
    const onFlush = vi.fn();
    const batch = new OverlayUpdateBatch(onFlush, scheduler);

    batch.append(delta(0));
    batch.clear();
    staleCallback?.();

    expect(onFlush).not.toHaveBeenCalled();
  });
});

describe("createFrameScheduler", () => {
  it("uses requestAnimationFrame and cancellation from the provided window", () => {
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 17;
    });
    const cancelAnimationFrame = vi.fn();
    const scheduler = createFrameScheduler({
      cancelAnimationFrame,
      requestAnimationFrame,
    } as unknown as Window);
    const callback = vi.fn();

    expect(scheduler.request(callback)).toBe(17);
    scheduler.cancel(17);

    expect(callback).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
  });
});

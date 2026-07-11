import { describe, expect, it, vi } from "vitest";

import { RequestQueue } from "./request-queue.js";

function deferred() {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      if (resolvePromise === undefined) {
        throw new Error("Deferred promise was not initialized.");
      }
      resolvePromise();
    },
  };
}

describe("RequestQueue", () => {
  it("runs at most two tasks and starts the next task when a slot opens", async () => {
    const queue = new RequestQueue(2);
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const starts: string[] = [];

    queue.enqueue("first", async () => {
      starts.push("first");
      await first.promise;
    });
    queue.enqueue("second", async () => {
      starts.push("second");
      await second.promise;
    });
    queue.enqueue("third", async () => {
      starts.push("third");
      await third.promise;
    });

    expect(starts).toEqual(["first", "second"]);
    expect(queue.activeCount).toBe(2);
    expect(queue.pendingCount).toBe(1);

    first.resolve();
    await vi.waitFor(() => expect(starts).toEqual(["first", "second", "third"]));
    second.resolve();
    third.resolve();
    await vi.waitFor(() => expect(queue.activeCount).toBe(0));
  });

  it("removes pending tasks and aborts active tasks", () => {
    const queue = new RequestQueue(1);
    let activeSignal: AbortSignal | undefined;
    let pendingStarted = false;

    queue.enqueue("active", (signal) => {
      activeSignal = signal;
      return new Promise(() => undefined);
    });
    queue.enqueue("pending", async () => {
      pendingStarted = true;
    });

    expect(queue.cancel("pending")).toBe("pending");
    expect(pendingStarted).toBe(false);
    expect(queue.cancel("active")).toBe("running");
    expect(activeSignal?.aborted).toBe(true);
  });

  it("rejects duplicate request IDs", () => {
    const queue = new RequestQueue(1);
    queue.enqueue("duplicate", () => new Promise(() => undefined));

    expect(() => queue.enqueue("duplicate", async () => undefined)).toThrow(/duplicate/i);
  });
});

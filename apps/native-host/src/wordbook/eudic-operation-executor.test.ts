import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_EUDIC_OPERATION_TIMEOUT_MS,
  EudicOperationExecutor,
} from "./eudic-operation-executor.js";

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (resolvePromise === undefined) {
        throw new Error("Deferred promise was not initialized.");
      }
      resolvePromise(value);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("EudicOperationExecutor", () => {
  it("serializes operations and reads fresh authorization for each one", async () => {
    const first = deferred<undefined>();
    const authorizations = ["NIS first", "NIS second"];
    const authorizationReader = {
      read: vi.fn(async () => {
        const authorization = authorizations.shift();
        if (authorization === undefined) throw new Error("Missing fake authorization.");
        return authorization;
      }),
    };
    const executor = new EudicOperationExecutor({ authorizationReader });
    let active = 0;
    let maximumActive = 0;
    const observedAuthorizations: string[] = [];
    const run = (authorization: string, block: boolean): Promise<string> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      observedAuthorizations.push(authorization);
      return (block ? first.promise : Promise.resolve()).then(() => {
        active -= 1;
        return authorization;
      });
    };

    const firstResult = executor.execute(
      (authorization) => run(authorization, true),
      new AbortController().signal,
    );
    const secondResult = executor.execute(
      (authorization) => run(authorization, false),
      new AbortController().signal,
    );

    await vi.waitFor(() => expect(authorizationReader.read).toHaveBeenCalledOnce());
    expect(observedAuthorizations).toEqual(["NIS first"]);
    first.resolve(undefined);

    await expect(firstResult).resolves.toBe("NIS first");
    await expect(secondResult).resolves.toBe("NIS second");
    expect(maximumActive).toBe(1);
    expect(authorizationReader.read).toHaveBeenCalledTimes(2);
  });

  it("uses the 10-second default deadline and maps it to TIMEOUT", async () => {
    vi.useFakeTimers();
    expect(DEFAULT_EUDIC_OPERATION_TIMEOUT_MS).toBe(10_000);
    const executor = new EudicOperationExecutor({
      authorizationReader: { read: async () => "NIS fake" },
    });
    const result = executor.execute(
      (_authorization, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      new AbortController().signal,
    );
    const assertion = expect(result).rejects.toMatchObject({ code: "TIMEOUT" });

    await vi.advanceTimersByTimeAsync(DEFAULT_EUDIC_OPERATION_TIMEOUT_MS - 1);
    await vi.advanceTimersByTimeAsync(1);

    await assertion;
  });

  it("maps caller cancellation to CANCELLED", async () => {
    const executor = new EudicOperationExecutor({
      authorizationReader: { read: async () => "NIS fake" },
    });
    const controller = new AbortController();
    const operation = vi.fn(
      (_authorization: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const result = executor.execute(operation, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());

    controller.abort();

    await assertion;
  });
});

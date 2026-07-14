import { describe, expect, it, vi } from "vitest";

import type { AddWordRequest, CheckWordRequest, WordbookAddOutcome } from "@huayi/protocol";

import {
  EudicWordbookProvider,
  type EudicAuthorizationReader,
  type EudicWordbookClient,
} from "./eudic-wordbook-provider.js";

const request: AddWordRequest = {
  context: "The investigation was in its early stages.",
  language: "en",
  requestId: "word-1",
  schemaVersion: 3,
  type: "add-word",
  word: "investigation",
};

const checkRequest: CheckWordRequest = {
  language: "en",
  requestId: "check-word-1",
  schemaVersion: 3,
  type: "check-word",
  word: "investigation",
};

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

describe("EudicWordbookProvider", () => {
  it("reads authorization for each operation and serializes client calls", async () => {
    const first = deferred<WordbookAddOutcome>();
    let active = 0;
    let maximumActive = 0;
    const client: EudicWordbookClient = {
      addWord: vi.fn(async (_authorization, currentRequest) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const result =
          currentRequest.requestId === "word-1" ? await first.promise : "already-exists";
        active -= 1;
        return result;
      }),
      checkWord: async () => "absent",
    };
    const authorizationReader: EudicAuthorizationReader = {
      read: vi.fn(async () => "NIS secret"),
    };
    const provider = new EudicWordbookProvider({ authorizationReader, client });

    const firstResult = provider.addWord(request, new AbortController().signal);
    const secondResult = provider.addWord(
      { ...request, requestId: "word-2" },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(client.addWord).toHaveBeenCalledTimes(1));
    first.resolve("added");

    await expect(firstResult).resolves.toBe("added");
    await expect(secondResult).resolves.toBe("already-exists");
    expect(maximumActive).toBe(1);
    expect(authorizationReader.read).toHaveBeenCalledTimes(2);
  });

  it("queues a check behind another Eudic operation and reads authorization for it", async () => {
    const first = deferred<WordbookAddOutcome>();
    const checkWord = vi.fn<EudicWordbookClient["checkWord"]>(async () => "present");
    const client: EudicWordbookClient = {
      addWord: vi.fn(async () => first.promise),
      checkWord,
    };
    let authorizationReads = 0;
    const authorizationReader: EudicAuthorizationReader = {
      read: vi.fn(async () => {
        authorizationReads += 1;
        return authorizationReads === 1 ? "NIS first" : "NIS second";
      }),
    };
    const provider = new EudicWordbookProvider({ authorizationReader, client });

    const addResult = provider.addWord(request, new AbortController().signal);
    const checkResult = provider.checkWord(checkRequest, new AbortController().signal);
    await vi.waitFor(() => expect(client.addWord).toHaveBeenCalledOnce());
    expect(checkWord).not.toHaveBeenCalled();
    expect(authorizationReader.read).toHaveBeenCalledOnce();
    first.resolve("added");

    await expect(addResult).resolves.toBe("added");
    await expect(checkResult).resolves.toBe("present");
    expect(checkWord).toHaveBeenCalledWith("NIS second", checkRequest, expect.any(AbortSignal));
    expect(authorizationReader.read).toHaveBeenCalledTimes(2);
  });

  it("applies the Eudic deadline to checks", async () => {
    const client: EudicWordbookClient = {
      addWord: async () => "added",
      checkWord: (_authorization, _request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    };
    const provider = new EudicWordbookProvider({
      authorizationReader: { read: async () => "NIS secret" },
      client,
      timeoutMs: 5,
    });

    await expect(
      provider.checkWord(checkRequest, new AbortController().signal),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("maps caller cancellation of a check to CANCELLED", async () => {
    const checkWord = vi.fn<EudicWordbookClient["checkWord"]>(
      async (_authorization, _request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const client: EudicWordbookClient = {
      addWord: async () => "added",
      checkWord,
    };
    const provider = new EudicWordbookProvider({
      authorizationReader: { read: async () => "NIS secret" },
      client,
    });
    const controller = new AbortController();

    const result = provider.checkWord(checkRequest, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(checkWord).toHaveBeenCalledOnce());
    controller.abort();
    await assertion;
  });

  it("maps an operation deadline to TIMEOUT and caller abort to CANCELLED", async () => {
    const client: EudicWordbookClient = {
      addWord: (_authorization, _request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      checkWord: async () => "absent",
    };
    const provider = new EudicWordbookProvider({
      authorizationReader: { read: async () => "NIS secret" },
      client,
      timeoutMs: 5,
    });

    await expect(provider.addWord(request, new AbortController().signal)).rejects.toMatchObject({
      code: "TIMEOUT",
    });

    const controller = new AbortController();
    const cancelled = provider.addWord({ ...request, requestId: "word-2" }, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("rejects an already-aborted operation while it waits for the serial queue", async () => {
    const first = deferred<WordbookAddOutcome>();
    const client: EudicWordbookClient = {
      addWord: async (_authorization, currentRequest) =>
        currentRequest.requestId === "word-1" ? first.promise : "added",
      checkWord: async () => "absent",
    };
    const provider = new EudicWordbookProvider({
      authorizationReader: { read: async () => "NIS secret" },
      client,
    });
    const firstResult = provider.addWord(request, new AbortController().signal);
    const controller = new AbortController();
    controller.abort();

    await expect(
      Promise.race([
        provider.addWord({ ...request, requestId: "word-2" }, controller.signal),
        new Promise((_, reject) => setTimeout(() => reject(new Error("did not cancel")), 20)),
      ]),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    first.resolve("added");
    await expect(firstResult).resolves.toBe("added");
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AddWordRequest,
  CheckWordRequest,
  WordbookAddOutcome,
  WordbookPresence,
} from "@huayi/protocol";

import type { EudicVocabEntry } from "../wordbook/eudic-client.js";
import { EudicOperationExecutor } from "../wordbook/eudic-operation-executor.js";
import {
  EudicWordbookProvider,
  type EudicWordbookClient,
} from "../wordbook/eudic-wordbook-provider.js";
import { WordSyncService, type EudicWordSyncClient } from "./word-sync-service.js";
import { WordSyncStateStore } from "./word-sync-state.js";

const temporaryDirectories: string[] = [];

function entries(count: number): EudicVocabEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    addTime: "2026-07-01T00:00:00.000Z",
    word: `word${"abcdefghij"[index] ?? "a"}`,
  }));
}

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

async function createStateStore(): Promise<WordSyncStateStore> {
  const directory = await mkdtemp(join(tmpdir(), "huayi-word-sync-service-"));
  temporaryDirectories.push(directory);
  return new WordSyncStateStore({ path: join(directory, "word-sync-state.json") });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("WordSyncService concurrency", () => {
  it.each(["check", "add"] as const)(
    "shares one serial Eudic gate between %s-word and word-sync polling",
    async (operation) => {
      const first = deferred<WordbookPresence | WordbookAddOutcome>();
      const authorizationReader = { read: vi.fn(async () => "NIS shared") };
      const operationExecutor = new EudicOperationExecutor({ authorizationReader });
      const execute = vi.spyOn(operationExecutor, "execute");
      const wordbookClient: EudicWordbookClient = {
        addWord: vi.fn(async () => first.promise as Promise<WordbookAddOutcome>),
        checkWord: vi.fn(async () => first.promise as Promise<WordbookPresence>),
      };
      const syncClient = {
        listFavoritedWords: vi.fn(async () => []),
      } satisfies EudicWordSyncClient;
      const provider = new EudicWordbookProvider({
        client: wordbookClient,
        operationExecutor,
      });
      const service = new WordSyncService({
        client: syncClient,
        operationExecutor,
        stateStore: await createStateStore(),
      });
      const signal = new AbortController().signal;
      const request =
        operation === "check"
          ? ({
              language: "en",
              requestId: "check-shared",
              schemaVersion: 6,
              type: "check-word",
              word: "investigation",
            } satisfies CheckWordRequest)
          : ({
              context: "The investigation continues.",
              language: "en",
              requestId: "add-shared",
              schemaVersion: 6,
              type: "add-word",
              word: "investigation",
            } satisfies AddWordRequest);
      const wordbookResult =
        operation === "check"
          ? provider.checkWord(request as CheckWordRequest, signal)
          : provider.addWord(request as AddWordRequest, signal);
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

      const pollResult = service.poll(signal);
      await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
      expect(syncClient.listFavoritedWords).not.toHaveBeenCalled();
      first.resolve(operation === "check" ? "absent" : "added");

      await expect(wordbookResult).resolves.toBe(operation === "check" ? "absent" : "added");
      await expect(pollResult).resolves.toMatchObject({ lastPollSucceeded: true });
      expect(syncClient.listFavoritedWords).toHaveBeenCalledOnce();
      expect(authorizationReader.read).toHaveBeenCalledTimes(2);
    },
  );

  it("applies an Eudic deadline to a sync page and persists TIMEOUT", async () => {
    const stateStore = await createStateStore();
    const operationExecutor = new EudicOperationExecutor({
      authorizationReader: { read: async () => "NIS fake" },
      timeoutMs: 5,
    });
    const service = new WordSyncService({
      client: {
        listFavoritedWords: (_authorization, _page, _recentDays, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      },
      operationExecutor,
      stateStore,
    });

    await expect(service.poll(new AbortController().signal)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    await expect(stateStore.load()).resolves.toMatchObject({
      lastErrorCode: "TIMEOUT",
      lastPollSucceeded: false,
    });
  });

  it("maps caller cancellation of a sync page to CANCELLED", async () => {
    const stateStore = await createStateStore();
    const operationExecutor = new EudicOperationExecutor({
      authorizationReader: { read: async () => "NIS fake" },
    });
    const listFavoritedWords = vi.fn<EudicWordSyncClient["listFavoritedWords"]>(
      async (_authorization, _page, _recentDays, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const service = new WordSyncService({
      client: { listFavoritedWords },
      operationExecutor,
      stateStore,
    });
    const controller = new AbortController();
    const result = service.poll(controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(listFavoritedWords).toHaveBeenCalledOnce());

    controller.abort();

    await assertion;
    await expect(stateStore.load()).resolves.toMatchObject({
      lastErrorCode: "CANCELLED",
      lastPollSucceeded: false,
    });
  });

  it("does not persist a cancelled mutation queued behind another service operation", async () => {
    const blockedPage = deferred<EudicVocabEntry[]>();
    const stateStore = await createStateStore();
    let now = new Date("2026-07-22T01:00:00.000Z");
    let pageCalls = 0;
    const listFavoritedWords = vi.fn<EudicWordSyncClient["listFavoritedWords"]>(async () => {
      pageCalls += 1;
      return pageCalls === 1 ? entries(1) : blockedPage.promise;
    });
    const service = new WordSyncService({
      authorizationReader: { read: async () => "NIS fake" },
      client: { listFavoritedWords },
      createBatchId: () => "batch-cancelled",
      now: () => now,
      stateStore,
    });
    await service.poll(new AbortController().signal);
    await service.prepareBatch();
    now = new Date("2026-07-23T01:00:00.000Z");
    const blockingPoll = service.poll(new AbortController().signal);
    await vi.waitFor(() => expect(listFavoritedWords).toHaveBeenCalledTimes(2));
    const controller = new AbortController();

    const cancelledResolution = service.resolveBatch("batch-cancelled", [], controller.signal);
    controller.abort();
    blockedPage.resolve([]);

    await expect(blockingPoll).resolves.toMatchObject({ lastPollSucceeded: true });
    await expect(cancelledResolution).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(stateStore.load()).resolves.toMatchObject({
      activeBatch: { batchId: "batch-cancelled" },
      pending: [expect.objectContaining({ sourceWord: "worda" })],
      resolved: [],
    });
  });

  it("does not persist a mutation cancelled while its state load is running", async () => {
    const stateStore = await createStateStore();
    const service = new WordSyncService({
      authorizationReader: { read: async () => "NIS fake" },
      client: { listFavoritedWords: async () => entries(1) },
      createBatchId: () => "batch-running-cancel",
      stateStore,
    });
    await service.poll(new AbortController().signal);
    await service.prepareBatch();
    const stateBeforeResolution = await stateStore.load();
    const blockedLoad = deferred<typeof stateBeforeResolution>();
    vi.spyOn(stateStore, "load").mockReturnValueOnce(blockedLoad.promise);
    const save = vi.spyOn(stateStore, "save");
    const controller = new AbortController();

    const resolution = service.resolveBatch("batch-running-cancel", [], controller.signal);
    await vi.waitFor(() => expect(stateStore.load).toHaveBeenCalled());
    controller.abort();
    blockedLoad.resolve(stateBeforeResolution);

    await expect(resolution).rejects.toMatchObject({ code: "CANCELLED" });
    expect(save).not.toHaveBeenCalled();
  });
});

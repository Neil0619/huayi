import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { EudicVocabEntry } from "../wordbook/eudic-client.js";
import { WordSyncService, type EudicWordSyncClient } from "./word-sync-service.js";
import { WordSyncStateStore } from "./word-sync-state.js";

const temporaryDirectories: string[] = [];

async function createService(
  client: EudicWordSyncClient,
  now: () => Date = () => new Date("2026-07-22T01:00:00.000Z"),
) {
  const directory = await mkdtemp(join(tmpdir(), "huayi-word-sync-service-"));
  temporaryDirectories.push(directory);
  return new WordSyncService({
    authorizationReader: { read: async () => "NIS fake" },
    client,
    createBatchId: () => "batch-1",
    now,
    stateStore: new WordSyncStateStore({ path: join(directory, "word-sync-state.json") }),
  });
}

function entries(count: number, offset = 0): EudicVocabEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    addTime: "2026-07-01T00:00:00.000Z",
    word: `word${String(index + offset).replaceAll(/\d/gu, (digit) => "abcdefghij"[Number(digit)] ?? "a")}`,
  }));
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

describe("WordSyncService", () => {
  it("scans all history, skips unsupported entries, and prepares an idempotent batch", async () => {
    const pages = [
      [...entries(99), { addTime: "2026-07-01T00:00:00.000Z", word: "two words" }],
      entries(50, 100),
    ];
    const client = {
      listFavoritedWords: vi.fn(async (_authorization, page: number) => pages[page] ?? []),
    } satisfies EudicWordSyncClient;
    const service = await createService(client);

    await expect(service.poll(new AbortController().signal)).resolves.toMatchObject({
      historyComplete: true,
      pendingCount: 149,
      scanInProgress: false,
      skippedCount: 1,
    });
    expect(client.listFavoritedWords).toHaveBeenNthCalledWith(
      1,
      "NIS fake",
      0,
      0,
      expect.any(AbortSignal),
    );
    const first = await service.prepareBatch();
    const repeated = await service.prepareBatch();
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ batchId: "batch-1", pendingAfterBatch: 49 });
    expect(first?.items).toHaveLength(100);
    await expect(service.resolveBatch("batch-1", [])).resolves.toMatchObject({
      batchId: "batch-1",
      pendingCount: 49,
      resolvedCount: 100,
      retryCount: 0,
      unresolved: [],
    });
  });

  it("persists a scan cursor after three full pages and resumes it", async () => {
    const client = {
      listFavoritedWords: vi.fn(async (_authorization, page: number) =>
        page < 3 ? entries(100, page * 100) : entries(2, 300),
      ),
    } satisfies EudicWordSyncClient;
    const service = await createService(client);

    await expect(service.poll(new AbortController().signal)).resolves.toMatchObject({
      pendingCount: 300,
      scanInProgress: true,
    });
    await expect(service.poll(new AbortController().signal)).resolves.toMatchObject({
      historyComplete: true,
      pendingCount: 302,
      scanInProgress: false,
    });
    expect(client.listFavoritedWords.mock.calls.map((call) => call[1])).toEqual([0, 1, 2, 3]);
  });

  it("uses the default wordbook source on the next local day", async () => {
    let now = new Date("2026-07-22T01:00:00.000Z");
    const client = {
      listFavoritedWords: vi.fn(
        async (authorization: string, page: number, recentDays: number, signal: AbortSignal) => {
          void authorization;
          void page;
          void recentDays;
          void signal;
          return [];
        },
      ),
    } satisfies EudicWordSyncClient;
    const service = await createService(client, () => now);
    await service.poll(new AbortController().signal);
    now = new Date("2026-07-23T02:00:00.000Z");
    await service.poll(new AbortController().signal);
    expect(client.listFavoritedWords.mock.calls.map((call) => call[2])).toEqual([0, 0]);
  });

  it("deduplicates old default-wordbook entries while adding a new daily word", async () => {
    let now = new Date("2026-07-22T01:00:00.000Z");
    let dailyScan = false;
    const client = {
      listFavoritedWords: vi.fn(async () =>
        dailyScan
          ? [
              { addTime: "2026-07-21T01:00:00.000Z", word: "existing" },
              { addTime: "2026-07-22T01:00:00.000Z", word: "impasse" },
            ]
          : [{ addTime: "2026-07-21T01:00:00.000Z", word: "existing" }],
      ),
    } satisfies EudicWordSyncClient;
    const service = await createService(client, () => now);
    await service.poll(new AbortController().signal);

    dailyScan = true;
    now = new Date("2026-07-23T01:00:00.000Z");
    await expect(service.poll(new AbortController().signal)).resolves.toMatchObject({
      pendingCount: 2,
    });
    await expect(service.prepareBatch()).resolves.toMatchObject({
      items: [
        { sourceWords: ["existing"], targetWord: "existing" },
        { sourceWords: ["impasse"], targetWord: "impasse" },
      ],
    });
  });

  it("keeps the previous success time until a multi-call daily scan completes", async () => {
    let now = new Date("2026-07-22T01:00:00.000Z");
    let dailyScan = false;
    const stateStore = await createStateStore();
    const client = {
      listFavoritedWords: vi.fn(async (_authorization: string, page: number) => {
        if (!dailyScan) return [];
        return page < 3 ? entries(100, page * 100) : entries(1, 300);
      }),
    } satisfies EudicWordSyncClient;
    const service = new WordSyncService({
      authorizationReader: { read: async () => "NIS fake" },
      client,
      now: () => now,
      stateStore,
    });
    await service.poll(new AbortController().signal);
    const previousSuccessTime = (await stateStore.load()).lastSuccessfulPollAt;

    dailyScan = true;
    now = new Date("2026-07-23T02:00:00.000Z");
    await expect(service.poll(new AbortController().signal)).resolves.toMatchObject({
      pendingCount: 300,
      pollDue: true,
      scanInProgress: true,
    });
    await expect(stateStore.load()).resolves.toMatchObject({
      lastSuccessfulPollAt: previousSuccessTime,
      scan: { mode: "incremental", nextPage: 3 },
    });

    await expect(service.poll(new AbortController().signal)).resolves.toMatchObject({
      pendingCount: 301,
      pollDue: false,
      scanInProgress: false,
    });
    await expect(stateStore.load()).resolves.toMatchObject({
      lastSuccessfulPollAt: "2026-07-23T02:00:00.000Z",
      scan: null,
    });
  });

  it("rejects a stale or repeated batch resolution", async () => {
    const service = await createService({ listFavoritedWords: async () => entries(1) });
    await service.poll(new AbortController().signal);
    await service.prepareBatch();
    await service.resolveBatch("batch-1", []);
    await expect(service.resolveBatch("batch-1", [])).rejects.toMatchObject({
      code: "WORD_SYNC_BATCH_MISMATCH",
    });
  });

  it("preserves the active batch when a rejected target is not in that batch", async () => {
    const service = await createService({ listFavoritedWords: async () => entries(1) });
    await service.poll(new AbortController().signal);
    const batch = await service.prepareBatch();
    await expect(service.resolveBatch("batch-1", ["unknown"])).rejects.toMatchObject({
      code: "WORD_SYNC_BATCH_RESULT_INVALID",
    });
    await expect(service.prepareBatch()).resolves.toEqual(batch);
  });

  it("normalizes case and curly apostrophes before deduplication and batching", async () => {
    const service = await createService({
      listFavoritedWords: async () => [
        { addTime: "2026-07-01T00:00:00.000Z", word: "DON’T" },
        { addTime: "2026-07-01T00:00:00.000Z", word: "Don't" },
      ],
    });
    await expect(service.poll(new AbortController().signal)).resolves.toMatchObject({
      pendingCount: 1,
    });
    await expect(Promise.all([service.prepareBatch(), service.prepareBatch()])).resolves.toEqual([
      expect.objectContaining({
        items: [
          {
            attempt: "original",
            sourceWords: ["don't"],
            targetWord: "don't",
          },
        ],
      }),
      expect.objectContaining({
        items: [
          {
            attempt: "original",
            sourceWords: ["don't"],
            targetWord: "don't",
          },
        ],
      }),
    ]);
  });
});

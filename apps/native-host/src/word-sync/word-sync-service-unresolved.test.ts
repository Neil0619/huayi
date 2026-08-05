import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { EudicVocabEntry } from "../wordbook/eudic-client.js";
import { WordSyncService, type EudicWordSyncClient } from "./word-sync-service.js";
import { WordSyncStateStore } from "./word-sync-state.js";

const temporaryDirectories: string[] = [];

async function createService(
  client: EudicWordSyncClient,
  now: () => Date = () => new Date(2026, 6, 22, 9, 0, 0, 0),
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("WordSyncService unresolved words", () => {
  it("resolves a mixed batch, retries unique lemmas once, and persists unresolved words", async () => {
    const service = await createService({
      listFavoritedWords: async () => [
        { addTime: "2026-07-01T00:00:00.000Z", word: "orbiting" },
        { addTime: "2026-07-01T00:00:00.000Z", word: "edges" },
        { addTime: "2026-07-01T00:00:00.000Z", word: "splendidly" },
        { addTime: "2026-07-01T00:00:00.000Z", word: "axes" },
      ],
    });
    await service.poll(new AbortController().signal);
    await service.prepareBatch();

    await expect(
      service.resolveBatch("batch-1", ["orbiting", "edges", "splendidly", "axes"]),
    ).resolves.toMatchObject({
      pendingCount: 2,
      resolvedCount: 0,
      retryCount: 2,
      unresolved: [
        expect.objectContaining({ reason: "no-lemma", sourceWord: "splendidly" }),
        expect.objectContaining({
          candidates: ["ax", "axe"],
          reason: "ambiguous-lemma",
          sourceWord: "axes",
        }),
      ],
      unresolvedCount: 2,
    });

    await expect(service.prepareBatch()).resolves.toMatchObject({
      items: [
        { attempt: "lemma", sourceWords: ["orbiting"], targetWord: "orbit" },
        { attempt: "lemma", sourceWords: ["edges"], targetWord: "edge" },
      ],
    });
    await expect(service.resolveBatch("batch-1", ["orbit"])).resolves.toMatchObject({
      pendingCount: 0,
      resolvedCount: 1,
      retryCount: 0,
      unresolved: [
        expect.objectContaining({
          lastTargetWord: "orbit",
          reason: "shanbay-rejected-lemma",
          sourceWord: "orbiting",
        }),
      ],
      unresolvedCount: 3,
    });
    await expect(service.listUnresolved(0, 2)).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ sourceWord: "splendidly" }),
        expect.objectContaining({ sourceWord: "axes" }),
      ]),
      offset: 0,
      totalCount: 3,
    });
    await expect(service.status()).resolves.toMatchObject({
      pendingCount: 0,
      unresolvedCount: 3,
    });
  });

  it("requeues a manual replacement or resolves it when the target already succeeded", async () => {
    const service = await createService({
      listFavoritedWords: async () => [
        { addTime: "2026-07-01T00:00:00.000Z", word: "edges" },
        { addTime: "2026-07-01T00:00:00.000Z", word: "splendidly" },
      ],
    });
    await service.poll(new AbortController().signal);
    await service.prepareBatch();
    await service.resolveBatch("batch-1", ["splendidly"]);

    await expect(
      service.requeueUnresolved([{ sourceWord: "splendidly", targetWord: "edges" }]),
    ).resolves.toMatchObject({
      pendingCount: 0,
      requeuedCount: 0,
      resolvedCount: 1,
      unresolvedCount: 0,
    });
  });

  it("atomically discards selected or all unresolved words without changing pending work", async () => {
    let now = new Date(2026, 6, 22, 9, 0, 0, 0);
    const service = await createService(
      {
        listFavoritedWords: async () => [
          { addTime: "2026-07-01T00:00:00.000Z", word: "splendidly" },
          { addTime: "2026-07-01T00:00:00.000Z", word: "axes" },
        ],
      },
      () => now,
    );
    await service.poll(new AbortController().signal);
    await service.prepareBatch();
    await service.resolveBatch("batch-1", ["splendidly", "axes"]);

    await expect(service.discardUnresolved(["splendidly"])).resolves.toEqual({
      discardedCount: 1,
      pendingCount: 0,
      unresolvedCount: 1,
    });
    await expect(service.discardUnresolved(["missing"])).rejects.toMatchObject({
      code: "WORD_SYNC_UNRESOLVED_MISMATCH",
    });
    await expect(service.listUnresolved(0, 100)).resolves.toMatchObject({
      items: [expect.objectContaining({ sourceWord: "axes" })],
      totalCount: 1,
    });
    await expect(service.discardAllUnresolved()).resolves.toEqual({
      discardedCount: 1,
      pendingCount: 0,
      unresolvedCount: 0,
    });
    await expect(service.status()).resolves.toMatchObject({ pendingCount: 0, unresolvedCount: 0 });
    now = new Date(2026, 6, 23, 9, 0, 0, 0);
    await service.poll(new AbortController().signal);
    await expect(service.status()).resolves.toMatchObject({ pendingCount: 0, unresolvedCount: 0 });
  });

  it("groups two rejected source words when they reduce to the same lemma", async () => {
    const service = await createService({
      listFavoritedWords: async () => [
        { addTime: "2026-07-01T00:00:00.000Z", word: "doodles" },
        { addTime: "2026-07-01T00:00:00.000Z", word: "doodling" },
      ],
    });
    await service.poll(new AbortController().signal);
    await service.prepareBatch();
    await service.resolveBatch("batch-1", ["doodles", "doodling"]);

    await expect(service.prepareBatch()).resolves.toMatchObject({
      items: [
        {
          attempt: "lemma",
          sourceWords: ["doodles", "doodling"],
          targetWord: "doodle",
        },
      ],
      pendingAfterBatch: 0,
    });
  });

  it("fails closed at the official 51-page history boundary", async () => {
    const service = await createService({
      listFavoritedWords: async (_authorization, page) => entries(100, page * 100),
    });
    for (let chunk = 0; chunk < 16; chunk += 1) {
      await service.poll(new AbortController().signal);
    }
    await expect(service.poll(new AbortController().signal)).rejects.toMatchObject({
      code: "WORD_SYNC_HISTORY_LIMIT",
    });
    await expect(service.status()).resolves.toMatchObject({
      historyComplete: false,
      lastPollSucceeded: false,
      pendingCount: 5_100,
      scanInProgress: false,
    });
  }, 10_000);
});

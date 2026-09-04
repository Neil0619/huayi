import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { reauditLegacyCompleted } from "./word-sync-legacy-reaudit.js";
import { resolveActiveBatch } from "./word-sync-resolution.js";
import { createInitialWordSyncState, WordSyncStateStore } from "./word-sync-state.js";

const temporaryDirectories: string[] = [];
const pendingScenarios: Promise<unknown>[] = [];
// These disk integration journeys include up to seven atomic writes, each with fsync.
const persistenceTimeoutMs = 15_000;

async function fixture(saveDelayMs = 0) {
  const directory = await mkdtemp(join(tmpdir(), "huayi-word-sync-reaudit-"));
  temporaryDirectories.push(directory);
  const store = new WordSyncStateStore({ path: join(directory, "word-sync-state.json") });
  const save = store.save.bind(store);
  vi.spyOn(store, "save").mockImplementation(async (state) => {
    if (saveDelayMs > 0) await delay(saveDelayMs);
    await save(state);
  });
  const state = createInitialWordSyncState();
  state.resolved = ["first", "second"].map((word) => ({
    outcome: "legacy-completed",
    sourceKey: word,
    sourceWord: word,
    targetKey: null,
    targetWord: null,
  }));
  await store.save(state);
  return store;
}

function withFixture(run: (store: WordSyncStateStore) => Promise<void>, saveDelayMs = 0) {
  const scenario = fixture(saveDelayMs).then(run);
  pendingScenarios.push(scenario);
  return scenario;
}

afterEach(async () => {
  try {
    // A timed-out async test still runs; drain its whole journey, not just its current save.
    await Promise.allSettled(pendingScenarios.splice(0));
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  } finally {
    vi.restoreAllMocks();
  }
}, persistenceTimeoutMs);

describe("reauditLegacyCompleted", { timeout: persistenceTimeoutMs }, () => {
  it("reports a dry run without moving legacy words", () =>
    withFixture(async (store) => {
      await expect(reauditLegacyCompleted(store, { confirm: false })).resolves.toEqual({
        dryRun: true,
        legacyCount: 2,
        requeuedCount: 0,
      });
      await expect(store.load()).resolves.toMatchObject({
        pending: [],
        resolved: expect.arrayContaining([
          expect.objectContaining({ outcome: "legacy-completed", sourceWord: "first" }),
        ]),
      });
    }));

  it.each([0, 1_500])(
    "supports a one-word probe before requeueing all remaining legacy words with a %i ms write delay",
    (saveDelayMs) =>
      withFixture(async (store) => {
        await expect(
          reauditLegacyCompleted(store, { confirm: true, probe: "first" }),
        ).resolves.toMatchObject({ legacyCount: 2, requeuedCount: 1 });
        const probedState = await store.load();
        probedState.activeBatch = { batchId: "probe-batch", sourceKeys: ["first"] };
        resolveActiveBatch(probedState, []);
        await store.save(probedState);
        expect(probedState.legacyReauditProbe).toEqual({
          sourceKey: "first",
          status: "accepted",
        });
        await expect(reauditLegacyCompleted(store, { confirm: true })).resolves.toMatchObject({
          legacyCount: 1,
          requeuedCount: 1,
        });
        await expect(new WordSyncStateStore({ path: store.path }).load()).resolves.toMatchObject({
          legacyReauditProbe: { sourceKey: "first", status: "accepted" },
          pending: [expect.objectContaining({ sourceWord: "second" })],
          resolved: [
            expect.objectContaining({
              outcome: "delivered-original",
              sourceWord: "first",
            }),
          ],
        });
      }, saveDelayMs),
  );

  it("blocks the full re-audit until a probe was accepted by Shanbay", () =>
    withFixture(async (store) => {
      await expect(reauditLegacyCompleted(store, { confirm: true })).rejects.toThrow(
        /accepted probe/i,
      );
      await reauditLegacyCompleted(store, { confirm: true, probe: "first" });
      await expect(reauditLegacyCompleted(store, { confirm: true })).rejects.toThrow(
        /accepted probe/i,
      );

      const state = await store.load();
      state.activeBatch = { batchId: "probe-batch", sourceKeys: ["first"] };
      resolveActiveBatch(state, ["first"]);
      await store.save(state);
      expect(state.legacyReauditProbe).toEqual({
        sourceKey: "first",
        status: "rejected",
      });
      await expect(reauditLegacyCompleted(store, { confirm: true })).rejects.toThrow(
        /accepted probe/i,
      );
    }));

  it("blocks a confirmed re-audit while a durable batch is active", () =>
    withFixture(async (store) => {
      const state = await store.load();
      state.pending.push({
        attempt: "original",
        attemptedTargetKeys: ["pending"],
        sourceKey: "pending",
        sourceWord: "pending",
        targetKey: "pending",
        targetWord: "pending",
      });
      state.activeBatch = { batchId: "batch-1", sourceKeys: ["pending"] };
      await store.save(state);
      await expect(reauditLegacyCompleted(store, { confirm: true })).rejects.toThrow(
        /active batch/i,
      );
    }));
});

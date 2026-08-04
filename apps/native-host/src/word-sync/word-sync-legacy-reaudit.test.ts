import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { reauditLegacyCompleted } from "./word-sync-legacy-reaudit.js";
import { resolveActiveBatch } from "./word-sync-resolution.js";
import { createInitialWordSyncState, WordSyncStateStore } from "./word-sync-state.js";

const temporaryDirectories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "huayi-word-sync-reaudit-"));
  temporaryDirectories.push(directory);
  const store = new WordSyncStateStore({ path: join(directory, "word-sync-state.json") });
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("reauditLegacyCompleted", () => {
  it("reports a dry run without moving legacy words", async () => {
    const store = await fixture();
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
  });

  it("supports a one-word probe before requeueing all remaining legacy words", async () => {
    const store = await fixture();
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
    await expect(store.load()).resolves.toMatchObject({
      pending: [expect.objectContaining({ sourceWord: "second" })],
      resolved: [
        expect.objectContaining({
          outcome: "delivered-original",
          sourceWord: "first",
        }),
      ],
    });
  });

  it("blocks the full re-audit until a probe was accepted by Shanbay", async () => {
    const store = await fixture();
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
  });

  it("blocks a confirmed re-audit while a durable batch is active", async () => {
    const store = await fixture();
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
    await expect(reauditLegacyCompleted(store, { confirm: true })).rejects.toThrow(/active batch/i);
  });
});

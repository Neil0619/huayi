import { chmod, mkdir, mkdtemp, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createInitialWordSyncState,
  WordSyncStateStore,
  type WordSyncStateV2,
} from "./word-sync-state.js";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ path: string; store: WordSyncStateStore }> {
  const directory = await mkdtemp(join(tmpdir(), "huayi-word-sync-state-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "word-sync-state.json");
  return { path, store: new WordSyncStateStore({ path }) };
}

function originalPending(word: string) {
  return {
    attempt: "original" as const,
    attemptedTargetKeys: [word],
    sourceKey: word,
    sourceWord: word,
    targetKey: word,
    targetWord: word,
  };
}

function createVersion2State(): WordSyncStateV2 {
  const state = createInitialWordSyncState();
  return {
    activeBatch: state.activeBatch,
    deliveredTargetKeys: state.deliveredTargetKeys,
    historyComplete: state.historyComplete,
    lastErrorCode: state.lastErrorCode,
    lastPollSucceeded: state.lastPollSucceeded,
    lastSuccessfulPollAt: state.lastSuccessfulPollAt,
    legacyReauditProbe: state.legacyReauditProbe,
    pending: state.pending,
    resolved: state.resolved,
    scan: state.scan,
    skippedCount: state.skippedCount,
    skippedKeys: state.skippedKeys,
    stateVersion: 2,
    unresolved: state.unresolved,
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("WordSyncStateStore", () => {
  it("creates an empty logical state without writing until the first save", async () => {
    const { path, store } = await fixture();
    await expect(store.load()).resolves.toEqual(createInitialWordSyncState());
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes a strict owner-only state and loads it again", async () => {
    const { path, store } = await fixture();
    const state = createInitialWordSyncState();
    state.pending.push(originalPending("investigation"));
    await store.save(state);

    await expect(store.load()).resolves.toMatchObject({ pending: state.pending });
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it("recovers a corrupt primary from the last valid backup", async () => {
    const { path, store } = await fixture();
    const first = createInitialWordSyncState();
    first.pending.push(originalPending("first"));
    await store.save(first);
    const second = structuredClone(first);
    second.pending.push(originalPending("second"));
    await store.save(second);
    await writeFile(path, "{broken", { mode: 0o600 });
    if (process.platform !== "win32") await chmod(path, 0o600);

    await expect(store.load()).resolves.toMatchObject({ pending: first.pending });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ pending: first.pending });
  });

  it.skipIf(process.platform !== "win32")(
    "preserves the primary and removes its temporary file when Windows locks replacement",
    async () => {
      const { path, store } = await fixture();
      const first = createInitialWordSyncState();
      first.pending.push(originalPending("first"));
      await store.save(first);
      const second = structuredClone(first);
      second.pending.push(originalPending("second"));
      const lockedPrimary = await open(path, "r+");
      try {
        await expect(store.save(second)).rejects.toMatchObject({ code: "EPERM" });
      } finally {
        await lockedPrimary.close();
      }

      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ pending: first.pending });
      expect((await readdir(join(path, ".."))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    },
  );

  it("fails closed when both primary and backup are invalid", async () => {
    const { path, store } = await fixture();
    await mkdir(join(path, "child"), { recursive: true });
    await writeFile(store.backupPath, "{broken", { mode: 0o600 });
    await expect(store.load()).rejects.toMatchObject({ code: "WORD_SYNC_STATE_INVALID" });
  });

  it("rejects duplicate or cross-lane word identities", async () => {
    const { path, store } = await fixture();
    const state = createInitialWordSyncState();
    state.pending = [
      originalPending("duplicate"),
      { ...originalPending("duplicate"), sourceWord: "Duplicate" },
    ];
    await writeFile(path, JSON.stringify(state), { mode: 0o600 });
    await expect(store.load()).rejects.toMatchObject({ code: "WORD_SYNC_STATE_INVALID" });
  });

  it("rejects a pending key that does not match its normalized word", async () => {
    const { path, store } = await fixture();
    const state = createInitialWordSyncState();
    state.pending = [{ ...originalPending("word"), sourceKey: "different" }];
    await writeFile(path, JSON.stringify(state), { mode: 0o600 });
    await expect(store.load()).rejects.toMatchObject({ code: "WORD_SYNC_STATE_INVALID" });
  });

  it("migrates v1 atomically while preserving the original file as the backup", async () => {
    const { path, store } = await fixture();
    const legacy = {
      activeBatch: { batchId: "batch-1", keys: ["orbiting"] },
      completedKeys: ["legacy"],
      historyComplete: true,
      lastErrorCode: null,
      lastPollSucceeded: true,
      lastSuccessfulPollAt: "2026-07-22T01:00:00.000Z",
      pending: [{ key: "orbiting", word: "orbiting" }],
      scan: null,
      skippedCount: 0,
      skippedKeys: [],
      stateVersion: 1,
    };
    await writeFile(path, JSON.stringify(legacy), { mode: 0o600 });

    await expect(store.load()).resolves.toMatchObject({
      activeBatch: { batchId: "batch-1", sourceKeys: ["orbiting"] },
      pending: [originalPending("orbiting")],
      resolved: [
        {
          outcome: "legacy-completed",
          sourceKey: "legacy",
          sourceWord: "legacy",
          targetKey: null,
          targetWord: null,
        },
      ],
      dataSourceVersion: "eudic-default-wordbook-v1",
      lastErrorCode: null,
      lastPollSucceeded: true,
      lastSuccessfulPollAt: null,
      scan: null,
      stateVersion: 3,
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ stateVersion: 3 });
    expect(JSON.parse(await readFile(store.backupPath, "utf8"))).toEqual(legacy);
    expect(JSON.parse(await readFile(store.legacySnapshotPath, "utf8"))).toEqual(legacy);

    const migrated = await store.load();
    migrated.pending.push(originalPending("later"));
    await store.save(migrated);
    expect(JSON.parse(await readFile(store.legacySnapshotPath, "utf8"))).toEqual(legacy);
  });

  it("migrates v2 to the default-wordbook source without losing synchronization lanes", async () => {
    const { path, store } = await fixture();
    const version2 = createVersion2State();
    version2.activeBatch = { batchId: "batch-v2", sourceKeys: ["pending"] };
    version2.historyComplete = true;
    version2.lastErrorCode = "NETWORK_ERROR";
    version2.lastPollSucceeded = false;
    version2.lastSuccessfulPollAt = "2026-07-29T01:38:52.600Z";
    version2.pending = [originalPending("pending")];
    version2.resolved = [
      {
        outcome: "delivered-original",
        sourceKey: "resolved",
        sourceWord: "resolved",
        targetKey: "resolved",
        targetWord: "resolved",
      },
      {
        outcome: "discarded",
        sourceKey: "mistke",
        sourceWord: "mistke",
        targetKey: "mistke",
        targetWord: "mistke",
      },
    ];
    version2.scan = {
      mode: "incremental",
      nextPage: 2,
      recentDays: 3,
      startedAt: "2026-07-29T01:38:52.600Z",
    };
    version2.skippedCount = 1;
    version2.skippedKeys = [`sha256:${"a".repeat(64)}`];
    version2.unresolved = [
      {
        attemptedTargetKeys: ["splendidly"],
        candidates: [],
        lastTargetKey: "splendidly",
        lastTargetWord: "splendidly",
        reason: "no-lemma",
        sourceKey: "splendidly",
        sourceWord: "splendidly",
      },
    ];
    await writeFile(path, JSON.stringify(version2), { mode: 0o600 });

    await expect(store.load()).resolves.toMatchObject({
      activeBatch: version2.activeBatch,
      dataSourceVersion: "eudic-default-wordbook-v1",
      historyComplete: true,
      lastErrorCode: null,
      lastPollSucceeded: true,
      lastSuccessfulPollAt: null,
      pending: version2.pending,
      resolved: version2.resolved,
      scan: null,
      skippedCount: 1,
      skippedKeys: version2.skippedKeys,
      stateVersion: 3,
      unresolved: version2.unresolved,
    });
    expect(JSON.parse(await readFile(store.version2SnapshotPath, "utf8"))).toEqual(version2);
    expect(JSON.parse(await readFile(store.backupPath, "utf8"))).toEqual(version2);

    const migrated = await store.load();
    migrated.pending.push(originalPending("later"));
    await store.save(migrated);
    expect(JSON.parse(await readFile(store.version2SnapshotPath, "utf8"))).toEqual(version2);
  });

  it("leaves the original v2 primary intact when its migration snapshot cannot be written", async () => {
    const { path, store } = await fixture();
    const version2 = createVersion2State();
    version2.lastSuccessfulPollAt = "2026-07-29T01:38:52.600Z";
    await writeFile(path, JSON.stringify(version2), { mode: 0o600 });
    await mkdir(store.version2SnapshotPath);

    await expect(store.load()).rejects.toMatchObject({ code: "WORD_SYNC_STATE_INVALID" });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(version2);
  });

  it("loads v3 repeatedly without rewriting its migration snapshot", async () => {
    const { path, store } = await fixture();
    const version2 = createVersion2State();
    await writeFile(path, JSON.stringify(version2), { mode: 0o600 });
    const migrated = await store.load();
    const snapshotBefore = await readFile(store.version2SnapshotPath, "utf8");

    await expect(store.load()).resolves.toEqual(migrated);
    expect(await readFile(store.version2SnapshotPath, "utf8")).toBe(snapshotBefore);
  });

  it("rejects a target that is absent from its attempted-target history", async () => {
    const { path, store } = await fixture();
    const state = createInitialWordSyncState();
    state.pending = [
      {
        ...originalPending("orbiting"),
        attempt: "lemma",
        attemptedTargetKeys: ["orbiting"],
        targetKey: "orbit",
        targetWord: "orbit",
      },
    ];
    await writeFile(path, JSON.stringify(state), { mode: 0o600 });
    await expect(store.load()).rejects.toMatchObject({ code: "WORD_SYNC_STATE_INVALID" });
  });

  it("rejects a non-legacy result with only half of its target identity", async () => {
    const { path, store } = await fixture();
    const state = createInitialWordSyncState();
    state.resolved = [
      {
        outcome: "delivered-original",
        sourceKey: "word",
        sourceWord: "word",
        targetKey: "word",
        targetWord: null,
      },
    ];
    await writeFile(path, JSON.stringify(state), { mode: 0o600 });
    await expect(store.load()).rejects.toMatchObject({ code: "WORD_SYNC_STATE_INVALID" });
  });

  it("persists discarded unresolved words with their last attempted target for audit", async () => {
    const { store } = await fixture();
    const state = createInitialWordSyncState();
    state.resolved = [
      {
        outcome: "discarded",
        sourceKey: "splendidly",
        sourceWord: "splendidly",
        targetKey: "splendidly",
        targetWord: "splendidly",
      },
    ];

    await store.save(state);
    await expect(store.load()).resolves.toMatchObject({ resolved: state.resolved });
  });
});

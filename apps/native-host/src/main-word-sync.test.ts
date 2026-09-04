import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import { createNativeHostDispatcher } from "./main.js";
import type { EudicFetch } from "./wordbook/eudic-client.js";
import { EudicOperationExecutor } from "./wordbook/eudic-operation-executor.js";
import { WordSyncService } from "./word-sync/word-sync-service.js";
import { WordSyncStateStore } from "./word-sync/word-sync-state.js";

const cleanups: (() => Promise<void>)[] = [];
const syncRequest = {
  requestId: "sync-shared-macos",
  schemaVersion: 7,
  type: "word-sync-poll",
} as const;

function deferred() {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      if (resolvePromise === undefined) throw new Error("Deferred promise was not initialized.");
      resolvePromise();
    },
  };
}

afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  } finally {
    vi.restoreAllMocks();
  }
});

async function createFixture({ saveDelayMs = 0, failSave = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "huayi-main-word-sync-"));
  const statePath = join(directory, "word-sync-state.json");
  const firstSaveStarted = deferred();
  const pendingPolls: Promise<unknown>[] = [];
  const originalSave = WordSyncStateStore.prototype.save;
  const originalPoll = WordSyncService.prototype.poll;
  let firstSave = true;

  vi.spyOn(WordSyncStateStore.prototype, "save").mockImplementation(async function (
    this: WordSyncStateStore,
    state,
  ) {
    if (firstSave) {
      firstSave = false;
      firstSaveStarted.resolve();
      if (saveDelayMs > 0) await delay(saveDelayMs);
      if (failSave) throw new Error("Fixture persistence failed.");
    }
    await originalSave.call(this, state);
  });
  vi.spyOn(WordSyncService.prototype, "poll").mockImplementation(function (
    this: WordSyncService,
    signal,
  ) {
    const pending = originalPoll.call(this, signal);
    pendingPolls.push(pending);
    return pending;
  });

  const eudicAuthorizationReader = { read: vi.fn(async () => "Bearer fixture") };
  const eudicOperationExecutor = new EudicOperationExecutor({
    authorizationReader: eudicAuthorizationReader,
  });
  const executeEudicOperation = vi.spyOn(eudicOperationExecutor, "execute");
  const eudicFetch = vi.fn<EudicFetch>(async (url) => {
    const body =
      url.includes("/vocab_entries") || url.includes("/words?")
        ? { data: [], message: "" }
        : { data: [] };
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  });
  const dispatcher = createNativeHostDispatcher({
    codexExecutable: "/opt/codex",
    environment: { HOME: "/Users/tester" },
    errorOutput: new PassThrough(),
    eudicAuthorizationReader,
    eudicFetch,
    eudicOperationExecutor,
    processRunner: {
      run: vi.fn(async () => {
        throw new Error("Process runner must not run.");
      }),
    },
    schemaDirectory: "/tmp/schemas",
    workingDirectory: "/tmp/work",
    wordSyncNow: () => new Date(2026, 7, 9, 12, 0, 0, 0),
    wordSyncStatePath: statePath,
  });
  const drain = async () => {
    await Promise.allSettled(pendingPolls);
  };
  const removeDirectory = () => rm(directory, { force: true, recursive: true });
  // Aborting a poll cannot cancel a state write that is already in flight.
  cleanups.push(async () => {
    dispatcher.dispose();
    await drain();
    await removeDirectory();
  });

  return {
    directory,
    dispatcher,
    drain,
    eudicAuthorizationReader,
    executeEudicOperation,
    firstSaveStarted: firstSaveStarted.promise,
    statePath,
    dispatch(request: unknown): Promise<HostEvent> {
      return new Promise((resolve) => {
        dispatcher.dispatch(request, (event) => {
          if (event.type !== "progress") resolve(event);
        });
      });
    },
    async dispose() {
      dispatcher.dispose();
      await drain();
      await removeDirectory();
    },
  };
}

describe("native host word-sync bootstrap", () => {
  it.each([0, 1_200])(
    "shares one Eudic executor and awaits persisted status with a %i ms write delay",
    async (saveDelayMs) => {
      const fixture = await createFixture({ saveDelayMs });
      try {
        expect(
          await fixture.dispatch({
            language: "en",
            requestId: "check-shared-macos",
            schemaVersion: 7,
            type: "check-word",
            word: "investigation",
          }),
        ).toMatchObject({ requestId: "check-shared-macos", type: "word-status" });
        expect(await fixture.dispatch(syncRequest)).toMatchObject({
          historyComplete: true,
          lastPollSucceeded: true,
          pendingCount: 0,
          requestId: syncRequest.requestId,
          scanInProgress: false,
          type: "word-sync-status",
        });
        expect(await new WordSyncStateStore({ path: fixture.statePath }).load()).toMatchObject({
          historyComplete: true,
          lastPollSucceeded: true,
          pending: [],
          scan: null,
        });
        expect(fixture.executeEudicOperation).toHaveBeenCalledTimes(2);
        expect(fixture.eudicAuthorizationReader.read).toHaveBeenCalledTimes(2);
      } finally {
        await fixture.dispose();
      }
      await expect(lstat(fixture.directory)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("returns a persistence error terminal instead of waiting for a success event", async () => {
    const fixture = await createFixture({ failSave: true });
    try {
      expect(await fixture.dispatch(syncRequest)).toMatchObject({
        error: { code: "INTERNAL_ERROR" },
        requestId: syncRequest.requestId,
        type: "error",
      });
    } finally {
      await fixture.dispose();
    }
  });

  it("does not remove or recreate the fixture directory while an aborted poll still writes", async () => {
    const fixture = await createFixture({ saveDelayMs: 1_200 });
    fixture.dispatcher.dispatch(syncRequest, () => undefined);
    await fixture.firstSaveStarted;

    await fixture.dispose();
    await fixture.drain();

    await expect(lstat(fixture.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

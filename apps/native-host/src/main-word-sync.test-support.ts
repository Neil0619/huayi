import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import { createNativeHostDispatcher } from "./main.js";
import type { EudicFetch } from "./wordbook/eudic-client.js";
import { EudicOperationExecutor } from "./wordbook/eudic-operation-executor.js";
import { WordSyncService } from "./word-sync/word-sync-service.js";
import { WordSyncStateStore } from "./word-sync/word-sync-state.js";

const cleanups: (() => Promise<void>)[] = [];

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

export async function disposeNativeHostWordSyncFixtures() {
  try {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  } finally {
    vi.restoreAllMocks();
  }
}

export async function createNativeHostWordSyncFixture({
  saveDelayMs = 0,
  failSave = false,
  platformMode = "default",
}: {
  saveDelayMs?: number;
  failSave?: boolean;
  platformMode?: "default" | "windows-deepseek";
} = {}) {
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
    ...(platformMode === "windows-deepseek"
      ? { environment: { SystemRoot: "C:\\Windows" } }
      : { codexExecutable: "/opt/codex", environment: { HOME: "/Users/tester" } }),
    deepSeekApiKeyReader: { read: async () => "unused-test-key" },
    platformMode,
    errorOutput: new PassThrough(),
    eudicAuthorizationReader,
    eudicFetch,
    eudicOperationExecutor,
    processRunner: {
      run: vi.fn(async () => {
        throw new Error("Process runner must not run.");
      }),
    },
    schemaDirectory:
      platformMode === "windows-deepseek" ? "C:\\Huayi\\provider\\schemas" : "/tmp/schemas",
    workingDirectory: platformMode === "windows-deepseek" ? "C:\\Huayi\\workdir" : "/tmp/work",
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
    eudicFetch,
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

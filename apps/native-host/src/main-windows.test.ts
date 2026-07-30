import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import { createNativeHostDispatcher } from "./main.js";
import { EudicOperationExecutor } from "./wordbook/eudic-operation-executor.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "huayi-main-windows-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "word-sync-state.json");
}

describe("Windows DeepSeek native host", () => {
  it("reports DeepSeek health and supports the Eudic wordbook", async () => {
    const wordSyncStatePath = await createTemporaryStatePath();
    const eudicAuthorizationReader = {
      read: vi.fn(async () => "Bearer test-authorization"),
    };
    const eudicOperationExecutor = new EudicOperationExecutor({
      authorizationReader: eudicAuthorizationReader,
    });
    const executeEudicOperation = vi.spyOn(eudicOperationExecutor, "execute");
    const eudicFetch = vi.fn(async () => ({
      body: new Response(JSON.stringify({ data: [], message: "" })).body,
      status: 200,
    }));
    const dispatcher = createNativeHostDispatcher({
      deepSeekApiKeyReader: { read: async () => "unused-test-key" },
      environment: { SystemRoot: "C:\\Windows" },
      errorOutput: new PassThrough(),
      eudicAuthorizationReader,
      eudicFetch,
      eudicOperationExecutor,
      platformMode: "windows-deepseek",
      processRunner: { run: vi.fn() },
      schemaDirectory: "C:\\Huayi\\provider\\schemas",
      workingDirectory: "C:\\Huayi\\workdir",
      wordSyncStatePath,
    });
    const healthEvents: HostEvent[] = [];
    const wordbookEvents: HostEvent[] = [];
    const wordSyncEvents: HostEvent[] = [];

    dispatcher.dispatch({ requestId: "health-win", schemaVersion: 6, type: "health" }, (event) =>
      healthEvents.push(event),
    );
    dispatcher.dispatch(
      {
        language: "en",
        requestId: "word-win",
        schemaVersion: 6,
        type: "check-word",
        word: "investigation",
      },
      (event) => wordbookEvents.push(event),
    );
    dispatcher.dispatch(
      { requestId: "word-sync-win", schemaVersion: 6, type: "word-sync-poll" },
      (event) => wordSyncEvents.push(event),
    );
    await vi.waitFor(() => expect(healthEvents).toHaveLength(1));
    await vi.waitFor(() =>
      expect(wordbookEvents.some((event) => event.type === "word-status")).toBe(true),
    );
    await vi.waitFor(() =>
      expect(wordSyncEvents.some((event) => event.type === "word-sync-status")).toBe(true),
    );

    expect(healthEvents[0]).toMatchObject({
      codexVersion: null,
      model: "deepseek-v4-flash",
      provider: "deepseek-chat-completions",
      ready: true,
    });
    expect(wordbookEvents.find((event) => event.type === "word-status")).toMatchObject({
      presence: "absent",
      type: "word-status",
    });
    expect(executeEudicOperation).toHaveBeenCalledTimes(2);
    expect(eudicAuthorizationReader.read).toHaveBeenCalledTimes(2);
    expect(eudicFetch).toHaveBeenCalledTimes(2);
    expect(wordSyncEvents.find((event) => event.type === "word-sync-status")).toMatchObject({
      historyComplete: true,
      pendingCount: 0,
      requestId: "word-sync-win",
      type: "word-sync-status",
    });
    dispatcher.dispose();
  });
});

import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import { createNativeHostDispatcher } from "./main.js";

describe("Windows DeepSeek native host", () => {
  it("reports DeepSeek health and supports the Eudic wordbook", async () => {
    const eudicAuthorizationReader = {
      read: vi.fn(async () => "Bearer test-authorization"),
    };
    const eudicFetch = vi.fn(async () => ({
      body: new Response(JSON.stringify({ data: [] })).body,
      status: 200,
    }));
    const dispatcher = createNativeHostDispatcher({
      deepSeekApiKeyReader: { read: async () => "unused-test-key" },
      environment: { SystemRoot: "C:\\Windows" },
      errorOutput: new PassThrough(),
      eudicAuthorizationReader,
      eudicFetch,
      platformMode: "windows-deepseek",
      processRunner: { run: vi.fn() },
      schemaDirectory: "C:\\Huayi\\provider\\schemas",
      workingDirectory: "C:\\Huayi\\workdir",
    });
    const healthEvents: HostEvent[] = [];
    const wordbookEvents: HostEvent[] = [];

    dispatcher.dispatch({ requestId: "health-win", schemaVersion: 5, type: "health" }, (event) =>
      healthEvents.push(event),
    );
    dispatcher.dispatch(
      {
        language: "en",
        requestId: "word-win",
        schemaVersion: 5,
        type: "check-word",
        word: "investigation",
      },
      (event) => wordbookEvents.push(event),
    );
    await vi.waitFor(() => expect(healthEvents).toHaveLength(1));
    await vi.waitFor(() =>
      expect(wordbookEvents.some((event) => event.type === "word-status")).toBe(true),
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
    expect(eudicAuthorizationReader.read).toHaveBeenCalledOnce();
    expect(eudicFetch).toHaveBeenCalledOnce();
    dispatcher.dispose();
  });
});

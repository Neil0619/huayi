import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import { createNativeHostDispatcher } from "./main.js";

describe("Windows DeepSeek-only native host", () => {
  it("reports DeepSeek health and disables wordbook work", async () => {
    const dispatcher = createNativeHostDispatcher({
      deepSeekApiKeyReader: { read: async () => "unused-test-key" },
      environment: { SystemRoot: "C:\\Windows" },
      errorOutput: new PassThrough(),
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
    await vi.waitFor(() => expect(wordbookEvents).toHaveLength(1));

    expect(healthEvents[0]).toMatchObject({
      codexVersion: null,
      model: "deepseek-v4-flash",
      provider: "deepseek-chat-completions",
      ready: true,
    });
    expect(wordbookEvents[0]).toMatchObject({
      error: { code: "EUDIC_NOT_CONFIGURED" },
      type: "error",
    });
    dispatcher.dispose();
  });
});

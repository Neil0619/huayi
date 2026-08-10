import { describe, expect, it } from "vitest";

import { hostEventSchema, hostRequestSchema, settingsStatusResultEventSchema } from "./index.js";

describe("wire v7 settings control", () => {
  it("accepts strict status and Provider-selection requests", () => {
    expect(
      hostRequestSchema.parse({
        requestId: "settings-1",
        schemaVersion: 7,
        type: "settings-status",
      }).type,
    ).toBe("settings-status");
    expect(
      hostRequestSchema.parse({
        provider: "deepseek-chat-completions",
        requestId: "settings-2",
        schemaVersion: 7,
        type: "settings-select-provider",
      }).type,
    ).toBe("settings-select-provider");
    expect(
      hostRequestSchema.safeParse({
        provider: "deepseek-chat-completions",
        requestId: "settings-2",
        schemaVersion: 7,
        type: "settings-select-provider",
        url: "https://example.com",
      }).success,
    ).toBe(false);
  });

  it("accepts only bounded, non-secret local status fields", () => {
    const event = {
      currentProvider: "codex",
      platform: "macos",
      providers: [
        { provider: "codex", status: "ready" },
        { provider: "openai-responses", status: "not-configured" },
        { provider: "openai-compatible-http", status: "not-configured" },
        { provider: "deepseek-chat-completions", status: "ready" },
      ],
      requestId: "settings-1",
      schemaVersion: 7,
      type: "settings-status-result",
      wordbookConfigured: true,
    } as const;
    expect(settingsStatusResultEventSchema.parse(event)).toEqual(event);
    expect(hostEventSchema.parse(event)).toEqual(event);
    expect(
      settingsStatusResultEventSchema.safeParse({ ...event, credential: "secret" }).success,
    ).toBe(false);
    expect(
      settingsStatusResultEventSchema.safeParse({ ...event, endpoint: "https://api.example" })
        .success,
    ).toBe(false);
    expect(
      settingsStatusResultEventSchema.safeParse({
        ...event,
        providers: event.providers.map((entry) => ({ ...entry, provider: "codex" })),
      }).success,
    ).toBe(false);
  });

  it("returns the selected Provider without configuration internals", () => {
    expect(
      hostEventSchema.parse({
        provider: "openai-responses",
        requestId: "settings-2",
        schemaVersion: 7,
        type: "settings-provider-selected",
      }),
    ).toEqual({
      provider: "openai-responses",
      requestId: "settings-2",
      schemaVersion: 7,
      type: "settings-provider-selected",
    });
  });
});

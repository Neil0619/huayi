import { describe, expect, it, vi } from "vitest";

import type { HostEvent, ModelProvider } from "@huayi/protocol";

import { SettingsConfigurationController } from "../config/settings-configuration-controller.js";
import { validResult } from "./dispatcher-test-helpers.js";
import { NativeMessageDispatcher } from "./dispatcher.js";

const readyProbe = { read: vi.fn(async () => "ready") };

function createDispatcher(): NativeMessageDispatcher {
  const settingsController = new SettingsConfigurationController({
    compatibleConfigurationProbe: readyProbe,
    compatibleCredentialProbe: readyProbe,
    codexProbe: readyProbe,
    deepSeekProbe: readyProbe,
    openAIProbe: readyProbe,
    platform: "macos",
    providerStore: {
      read: vi.fn(async (): Promise<ModelProvider> => "codex"),
      write: vi.fn(async (provider) => ({ dryRun: false, provider })),
    },
    wordbookProbe: readyProbe,
  });
  return new NativeMessageDispatcher({
    healthCheck: vi.fn(),
    provider: { analyze: async () => validResult, warmup: async () => undefined },
    settingsController,
  });
}

describe("NativeMessageDispatcher settings control", () => {
  it("emits a strict bounded settings status", async () => {
    const dispatcher = createDispatcher();
    const events: HostEvent[] = [];
    dispatcher.dispatch(
      { requestId: "settings-1", schemaVersion: 7, type: "settings-status" },
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      currentProvider: "codex",
      platform: "macos",
      requestId: "settings-1",
      type: "settings-status-result",
      wordbookConfigured: true,
    });
  });

  it("selects a ready Provider without affecting the analysis queue", async () => {
    const dispatcher = createDispatcher();
    const events: HostEvent[] = [];
    dispatcher.dispatch(
      {
        provider: "deepseek-chat-completions",
        requestId: "settings-2",
        schemaVersion: 7,
        type: "settings-select-provider",
      },
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({
      provider: "deepseek-chat-completions",
      requestId: "settings-2",
      schemaVersion: 7,
      type: "settings-provider-selected",
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import { SettingsConfigurationController } from "./settings-configuration-controller.js";

const readyProbe = { read: vi.fn(async () => "configured") };
const missingProbe = {
  read: vi.fn(async () => Promise.reject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" })),
};

describe("SettingsConfigurationController", () => {
  it("returns a bounded four-Provider macOS status and writes only ready Providers", async () => {
    const store = {
      read: vi.fn(async () => "codex" as const),
      write: vi.fn(async (provider) => ({ dryRun: false, provider })),
    };
    const controller = new SettingsConfigurationController({
      compatibleConfigurationProbe: readyProbe,
      compatibleCredentialProbe: readyProbe,
      codexProbe: readyProbe,
      deepSeekProbe: readyProbe,
      openAIProbe: missingProbe,
      platform: "macos",
      providerStore: store,
      wordbookProbe: readyProbe,
    });

    expect(await controller.status()).toEqual({
      currentProvider: "codex",
      platform: "macos",
      providers: [
        { provider: "codex", status: "ready" },
        { provider: "openai-responses", status: "not-configured" },
        { provider: "openai-compatible-http", status: "ready" },
        { provider: "deepseek-chat-completions", status: "ready" },
      ],
      wordbookConfigured: true,
    });
    await expect(controller.selectProvider("deepseek-chat-completions")).resolves.toBe(
      "deepseek-chat-completions",
    );
    expect(store.write).toHaveBeenCalledWith("deepseek-chat-completions", false);
    await expect(controller.selectProvider("openai-responses")).rejects.toThrow();
  });

  it("keeps Windows fixed to DeepSeek and marks alternate Providers unsupported", async () => {
    const controller = new SettingsConfigurationController({
      deepSeekProbe: readyProbe,
      platform: "windows",
      wordbookProbe: missingProbe,
    });
    expect(await controller.status()).toEqual({
      currentProvider: "deepseek-chat-completions",
      platform: "windows",
      providers: [
        { provider: "codex", status: "unsupported" },
        { provider: "openai-responses", status: "unsupported" },
        { provider: "openai-compatible-http", status: "unsupported" },
        { provider: "deepseek-chat-completions", status: "ready" },
      ],
      wordbookConfigured: false,
    });
    await expect(controller.selectProvider("codex")).rejects.toThrow();
    await expect(controller.selectProvider("deepseek-chat-completions")).resolves.toBe(
      "deepseek-chat-completions",
    );
  });

  it("propagates unexpected local probe failures instead of reporting missing configuration", async () => {
    const failure = new Error("keychain unavailable");
    const controller = new SettingsConfigurationController({
      deepSeekProbe: { read: vi.fn(async () => Promise.reject(failure)) },
      platform: "windows",
      wordbookProbe: readyProbe,
    });
    await expect(controller.status()).rejects.toBe(failure);
  });
});

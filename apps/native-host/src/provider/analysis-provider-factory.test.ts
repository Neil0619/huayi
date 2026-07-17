import { describe, expect, it, vi } from "vitest";

import type { ModelProvider } from "@huayi/protocol";

import type { CompatibleHttpConfigurationStore } from "../config/compatible-http-configuration-store.js";
import type { CompatibleHttpApiKeyReader } from "../credentials/compatible-http-keychain.js";
import type { DeepSeekApiKeyReader } from "../credentials/deepseek-keychain.js";
import type { OpenAIApiKeyReader } from "../credentials/openai-keychain.js";
import type { CodexAppServer } from "../runtime/codex-app-server-lifecycle.js";
import type { EudicFetch } from "../wordbook/eudic-client.js";
import { createAnalysisProviderFactory } from "./analysis-provider-factory.js";
import type { CompatibleHttpFetch } from "./compatible-http-responses-client.js";
import type { DeepSeekFetch } from "./deepseek-chat-client.js";
import type { OpenAIFetch } from "./openai-responses-client.js";

function createAppServer(): CodexAppServer & {
  dispose: ReturnType<typeof vi.fn>;
  warmup: ReturnType<typeof vi.fn<CodexAppServer["warmup"]>>;
} {
  return {
    dispose: vi.fn(),
    interrupt: vi.fn(async () => undefined),
    runTurn: vi.fn(async () => ""),
    warmup: vi.fn(async (signal: AbortSignal) => {
      void signal;
    }),
  };
}

function createFactory(provider: ModelProvider) {
  const configurationStore = {
    provider,
    read: vi.fn(async function (this: { provider: ModelProvider }) {
      return this.provider;
    }),
  };
  const appServer = createAppServer();
  const apiKeyRead = vi.fn(async () => "fake-key");
  const compatibleConfigurationRead = vi.fn(async () => ({
    allowInsecureHttp: true as const,
    baseUrl: "http://101.133.153.118:9090/v1",
    effort: "low" as const,
    model: "gpt-5.4-mini" as const,
    schemaVersion: 1 as const,
  }));
  const compatibleKeyRead = vi.fn(async () => "fake-compatible-key");
  const compatibleHttpFetch = vi.fn<CompatibleHttpFetch>(async () => {
    throw new Error("Compatible HTTP fetch must not run.");
  });
  const deepSeekKeyRead = vi.fn(async () => "fake-deepseek-key");
  const deepSeekFetch = vi.fn<DeepSeekFetch>(async () => {
    throw new Error("DeepSeek fetch must not run.");
  });
  const openAIFetch = vi.fn<OpenAIFetch>(async () => {
    throw new Error("OpenAI fetch must not run.");
  });
  const codexHealthCheck = vi.fn(async () => ({ codexVersion: "codex-cli 0.144.1" }));
  const eudicAuthorizationRead = vi.fn(async () => "Bearer fake");
  const eudicFetch = vi.fn<EudicFetch>(async () => {
    throw new Error("Eudic fetch must not run.");
  });
  const factory = createAnalysisProviderFactory({
    apiKeyReader: { read: apiKeyRead } as unknown as OpenAIApiKeyReader,
    appServer,
    codexHealthCheck,
    compatibleHttpApiKeyReader: {
      read: compatibleKeyRead,
    } as unknown as CompatibleHttpApiKeyReader,
    compatibleHttpConfigurationStore: {
      read: compatibleConfigurationRead,
    } as unknown as CompatibleHttpConfigurationStore,
    compatibleHttpFetch,
    configurationStore,
    deepSeekApiKeyReader: { read: deepSeekKeyRead } as unknown as DeepSeekApiKeyReader,
    deepSeekFetch,
    eudicAuthorizationReader: { read: eudicAuthorizationRead },
    eudicFetch,
    openAIFetch,
    schemaDirectory: "/tmp/schemas",
  });
  return {
    apiKeyRead,
    appServer,
    codexHealthCheck,
    compatibleConfigurationRead,
    compatibleHttpFetch,
    compatibleKeyRead,
    configurationStore,
    deepSeekFetch,
    deepSeekKeyRead,
    eudicAuthorizationRead,
    eudicFetch,
    factory,
    openAIFetch,
  };
}

describe("createAnalysisProviderFactory", () => {
  it("reports compatible health locally without Keychain, fetch, or Codex", async () => {
    const fixture = createFactory("openai-compatible-http");

    await expect(fixture.factory.healthCheck()).resolves.toEqual({
      codexVersion: null,
      model: "gpt-5.4-mini",
      provider: "openai-compatible-http",
    });

    expect(fixture.configurationStore.read).toHaveBeenCalledOnce();
    expect(fixture.codexHealthCheck).not.toHaveBeenCalled();
    expect(fixture.appServer.warmup).not.toHaveBeenCalled();
    expect(fixture.apiKeyRead).not.toHaveBeenCalled();
    expect(fixture.compatibleConfigurationRead).toHaveBeenCalledOnce();
    expect(fixture.compatibleKeyRead).not.toHaveBeenCalled();
    expect(fixture.compatibleHttpFetch).not.toHaveBeenCalled();
    expect(fixture.openAIFetch).not.toHaveBeenCalled();
    expect(fixture.eudicAuthorizationRead).not.toHaveBeenCalled();
    expect(fixture.eudicFetch).not.toHaveBeenCalled();
  });

  it("reports API health from the current configuration without Codex, Keychain, or fetch", async () => {
    const fixture = createFactory("openai-responses");

    await expect(fixture.factory.healthCheck()).resolves.toEqual({
      codexVersion: null,
      model: "gpt-5.6-luna",
      provider: "openai-responses",
    });

    expect(fixture.configurationStore.read).toHaveBeenCalledOnce();
    expect(fixture.codexHealthCheck).not.toHaveBeenCalled();
    expect(fixture.appServer.warmup).not.toHaveBeenCalled();
    expect(fixture.apiKeyRead).not.toHaveBeenCalled();
    expect(fixture.openAIFetch).not.toHaveBeenCalled();
    expect(fixture.eudicAuthorizationRead).not.toHaveBeenCalled();
    expect(fixture.eudicFetch).not.toHaveBeenCalled();
  });

  it("reports DeepSeek health locally without reading its Keychain item or fetching", async () => {
    const fixture = createFactory("deepseek-chat-completions");

    await expect(fixture.factory.healthCheck()).resolves.toEqual({
      codexVersion: null,
      model: "deepseek-v4-flash",
      provider: "deepseek-chat-completions",
    });

    expect(fixture.deepSeekKeyRead).not.toHaveBeenCalled();
    expect(fixture.deepSeekFetch).not.toHaveBeenCalled();
    expect(fixture.codexHealthCheck).not.toHaveBeenCalled();
  });

  it("validates Codex capabilities and reports the fixed Codex model", async () => {
    const fixture = createFactory("codex");

    await expect(fixture.factory.healthCheck()).resolves.toEqual({
      codexVersion: "codex-cli 0.144.1",
      model: "gpt-5.4-mini",
      provider: "codex",
    });

    expect(fixture.configurationStore.read).toHaveBeenCalledOnce();
    expect(fixture.codexHealthCheck).toHaveBeenCalledOnce();
    expect(fixture.apiKeyRead).not.toHaveBeenCalled();
    expect(fixture.openAIFetch).not.toHaveBeenCalled();
  });

  it("uses current configuration for each health check and API warmup stays local", async () => {
    const fixture = createFactory("openai-responses");
    const signal = new AbortController().signal;

    await fixture.factory.analysisProvider.warmup(signal);
    fixture.configurationStore.provider = "openai-compatible-http";
    await fixture.factory.analysisProvider.warmup(signal);
    fixture.configurationStore.provider = "codex";
    await fixture.factory.analysisProvider.warmup(signal);
    await fixture.factory.healthCheck();

    expect(fixture.configurationStore.read).toHaveBeenCalledTimes(4);
    expect(fixture.appServer.warmup).toHaveBeenCalledOnce();
    expect(fixture.apiKeyRead).not.toHaveBeenCalled();
    expect(fixture.openAIFetch).not.toHaveBeenCalled();
    expect(fixture.compatibleKeyRead).not.toHaveBeenCalled();
    expect(fixture.compatibleHttpFetch).not.toHaveBeenCalled();
    expect(fixture.codexHealthCheck).toHaveBeenCalledOnce();
    expect(fixture.factory.wordbookProvider).toBeDefined();
  });
});

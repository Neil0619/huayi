import { describe, expect, it, vi } from "vitest";

import type { ModelProvider } from "@huayi/protocol";

import type { OpenAIApiKeyReader } from "../credentials/openai-keychain.js";
import type { CodexAppServer } from "../runtime/codex-app-server-lifecycle.js";
import type { EudicFetch } from "../wordbook/eudic-client.js";
import { createAnalysisProviderFactory } from "./analysis-provider-factory.js";
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
    configurationStore,
    eudicAuthorizationReader: { read: eudicAuthorizationRead },
    eudicFetch,
    openAIFetch,
    schemaDirectory: "/tmp/schemas",
  });
  return {
    apiKeyRead,
    appServer,
    codexHealthCheck,
    configurationStore,
    eudicAuthorizationRead,
    eudicFetch,
    factory,
    openAIFetch,
  };
}

describe("createAnalysisProviderFactory", () => {
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
    fixture.configurationStore.provider = "codex";
    await fixture.factory.analysisProvider.warmup(signal);
    await fixture.factory.healthCheck();

    expect(fixture.configurationStore.read).toHaveBeenCalledTimes(3);
    expect(fixture.appServer.warmup).toHaveBeenCalledOnce();
    expect(fixture.apiKeyRead).not.toHaveBeenCalled();
    expect(fixture.openAIFetch).not.toHaveBeenCalled();
    expect(fixture.codexHealthCheck).toHaveBeenCalledOnce();
    expect(fixture.factory.wordbookProvider).toBeDefined();
  });
});

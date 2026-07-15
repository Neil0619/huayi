import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import type { CompatibleHttpApiKeyReader } from "./credentials/compatible-http-keychain.js";
import type { OpenAIApiKeyReader } from "./credentials/openai-keychain.js";
import { createNativeHostDispatcher } from "./main.js";
import type { CompatibleHttpFetch } from "./provider/compatible-http-responses-client.js";
import type { OpenAIFetch } from "./provider/openai-responses-client.js";
import type { ProcessRunner } from "./runtime/codex-process.js";

const temporaryDirectories: string[] = [];

async function providerConfigurationPath(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "huayi-main-provider-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "provider.json");
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function neverProcessRunner(): ProcessRunner & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async () => {
      throw new Error("Process runner must not run.");
    }),
  };
}

describe("native host provider routing", () => {
  it("reports compatible health from the sibling configuration without external work", async () => {
    const configurationPath = await providerConfigurationPath(
      `${JSON.stringify({ provider: "openai-compatible-http", schemaVersion: 1 })}\n`,
    );
    await writeFile(
      join(configurationPath, "..", "compatible-http.json"),
      `${JSON.stringify({
        allowInsecureHttp: true,
        baseUrl: "http://101.133.153.118:9090/v1",
        effort: "low",
        model: "gpt-5.4-mini",
        schemaVersion: 1,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    const processRunner = neverProcessRunner();
    const compatibleKeyRead = vi.fn(async () => "fake-compatible-key");
    const compatibleHttpFetch = vi.fn<CompatibleHttpFetch>(async () => {
      throw new Error("Compatible fetch must not run.");
    });
    const dispatcher = createNativeHostDispatcher({
      codexExecutable: "/opt/codex",
      compatibleHttpApiKeyReader: {
        read: compatibleKeyRead,
      } as unknown as CompatibleHttpApiKeyReader,
      compatibleHttpFetch,
      environment: { HOME: "/Users/tester" },
      errorOutput: new PassThrough(),
      processRunner,
      providerConfigurationPath: configurationPath,
      schemaDirectory: "/tmp/schemas",
      workingDirectory: "/tmp/work",
    });
    const events: HostEvent[] = [];

    dispatcher.dispatch(
      { requestId: "health-compatible", schemaVersion: 4, type: "health" },
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));

    expect(events[0]).toMatchObject({
      codexVersion: null,
      model: "gpt-5.4-mini",
      provider: "openai-compatible-http",
      ready: true,
      type: "health-result",
    });
    expect(processRunner.run).not.toHaveBeenCalled();
    expect(compatibleKeyRead).not.toHaveBeenCalled();
    expect(compatibleHttpFetch).not.toHaveBeenCalled();
    dispatcher.dispose();
  });

  it("reports API health without Codex capability, Keychain, or fetch side effects", async () => {
    const configurationPath = await providerConfigurationPath(
      `${JSON.stringify({ provider: "openai-responses", schemaVersion: 1 })}\n`,
    );
    const processRunner = neverProcessRunner();
    const apiKeyRead = vi.fn(async () => "fake-key");
    const openAIFetch = vi.fn<OpenAIFetch>(async () => {
      throw new Error("OpenAI fetch must not run.");
    });
    const dispatcher = createNativeHostDispatcher({
      codexExecutable: "/opt/codex",
      environment: { HOME: "/Users/tester" },
      errorOutput: new PassThrough(),
      openAIApiKeyReader: { read: apiKeyRead } as unknown as OpenAIApiKeyReader,
      openAIFetch,
      processRunner,
      providerConfigurationPath: configurationPath,
      schemaDirectory: "/tmp/schemas",
      workingDirectory: "/tmp/work",
    });
    const events: HostEvent[] = [];

    dispatcher.dispatch({ requestId: "health-api", schemaVersion: 4, type: "health" }, (event) =>
      events.push(event),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));

    expect(events).toEqual([
      {
        codexVersion: null,
        hostVersion: "0.5.0",
        model: "gpt-5.6-luna",
        provider: "openai-responses",
        ready: true,
        requestId: "health-api",
        schemaVersion: 4,
        type: "health-result",
      },
    ]);
    expect(processRunner.run).not.toHaveBeenCalled();
    expect(apiKeyRead).not.toHaveBeenCalled();
    expect(openAIFetch).not.toHaveBeenCalled();
    dispatcher.dispose();
  });

  it("maps an invalid provider file to a fixed internal error without its contents", async () => {
    const secret = "fake-provider-file-secret";
    const configurationPath = await providerConfigurationPath(`{${secret}\n`);
    const processRunner = neverProcessRunner();
    const dispatcher = createNativeHostDispatcher({
      codexExecutable: "/opt/codex",
      environment: { HOME: "/Users/tester" },
      errorOutput: new PassThrough(),
      processRunner,
      providerConfigurationPath: configurationPath,
      schemaDirectory: "/tmp/schemas",
      workingDirectory: "/tmp/work",
    });
    const events: HostEvent[] = [];

    dispatcher.dispatch(
      { requestId: "health-invalid-provider", schemaVersion: 4, type: "health" },
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));

    expect(events[0]).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        message: "本机模型服务处理失败，请重试。",
        retryable: true,
      },
      requestId: "health-invalid-provider",
      type: "error",
    });
    expect(JSON.stringify(events[0])).not.toContain(secret);
    expect(processRunner.run).not.toHaveBeenCalled();
    dispatcher.dispose();
  });
});

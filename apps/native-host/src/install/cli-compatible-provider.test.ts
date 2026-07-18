import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CompatibleHttpConfigurationStore } from "../config/compatible-http-configuration-store.js";
import { ProviderConfigurationStore } from "../config/provider-configuration-store.js";
import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  executeInstallerCommand,
  parseInstallerArguments,
  type InstallerCliOperations,
  type InstallerCliRuntime,
} from "./cli.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.skipIf(process.platform === "win32")("compatible Provider selection", () => {
  it("validates only local compatible configuration before writing provider.json", async () => {
    const directory = await mkdtemp(join(tmpdir(), "huayi-compatible-cli-test-"));
    temporaryDirectories.push(directory);
    const configurationPath = join(directory, "provider.json");
    const providerConfigurationStore = new ProviderConfigurationStore(configurationPath);
    const write = vi.spyOn(providerConfigurationStore, "write");
    const compatibleHttpConfigurationStore = new CompatibleHttpConfigurationStore(
      join(directory, "compatible-http.json"),
    );
    await compatibleHttpConfigurationStore.write(
      {
        allowInsecureHttp: true,
        baseUrl: "http://101.133.153.118:9090/v1",
        effort: "low",
        model: "gpt-5.4-mini",
        schemaVersion: 1,
      },
      false,
    );
    const compatibleRead = vi.spyOn(compatibleHttpConfigurationStore, "read");
    const operations: InstallerCliOperations = {
      configureEudic: vi.fn(),
      configureOpenAI: vi.fn(),
      install: vi.fn(),
      removeEudic: vi.fn(),
      removeOpenAI: vi.fn(),
      uninstall: vi.fn(),
    };
    const processRunner: ProcessRunner = { run: vi.fn() };
    const runtime: InstallerCliRuntime = {
      compatibleCredentialOperations: {
        configureCompatible: vi.fn(),
        removeCompatible: vi.fn(),
      },
      compatibleHttpConfigurationStore,
      environment: { PATH: "" },
      homeDirectory: "/Users/tester",
      interactiveProcessRunner: { run: vi.fn() },
      nodeExecutable: "/opt/node",
      nodeVersion: "20.19.0",
      operations,
      platform: "darwin",
      processRunner,
      providerConfigurationStore,
      securityExecutable: "/usr/bin/security",
      sourceBundlePath: "/build/main.js",
      sourceSchemaDirectory: "/build/provider/schemas",
      writeOutput: vi.fn(),
    };
    const command = parseInstallerArguments(["provider-set", "compatible-http"]);

    await executeInstallerCommand(command, runtime);

    expect(command).toMatchObject({ provider: "openai-compatible-http" });
    expect(compatibleRead).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith("openai-compatible-http", false);
    await expect(providerConfigurationStore.read()).resolves.toBe("openai-compatible-http");
    expect(
      Object.values(operations).every((operation) => !vi.mocked(operation).mock.calls.length),
    ).toBe(true);
    expect(runtime.writeOutput).toHaveBeenCalledWith("Set provider to openai-compatible-http.");
    expect(processRunner.run).not.toHaveBeenCalled();
    expect(runtime.interactiveProcessRunner.run).not.toHaveBeenCalled();
  });

  it("does not write provider selection when compatible configuration is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "huayi-compatible-cli-test-"));
    temporaryDirectories.push(directory);
    const providerConfigurationStore = new ProviderConfigurationStore(
      join(directory, "provider.json"),
    );
    const write = vi.spyOn(providerConfigurationStore, "write");
    const runtime = {
      compatibleCredentialOperations: {
        configureCompatible: vi.fn(),
        removeCompatible: vi.fn(),
      },
      compatibleHttpConfigurationStore: new CompatibleHttpConfigurationStore(
        join(directory, "compatible-http.json"),
      ),
      environment: { PATH: "" },
      homeDirectory: "/Users/tester",
      interactiveProcessRunner: { run: vi.fn() },
      nodeExecutable: "/opt/node",
      nodeVersion: "20.19.0",
      operations: {
        configureEudic: vi.fn(),
        configureOpenAI: vi.fn(),
        install: vi.fn(),
        removeEudic: vi.fn(),
        removeOpenAI: vi.fn(),
        uninstall: vi.fn(),
      },
      platform: "darwin" as const,
      processRunner: { run: vi.fn() },
      providerConfigurationStore,
      securityExecutable: "/usr/bin/security",
      sourceBundlePath: "/build/main.js",
      sourceSchemaDirectory: "/build/provider/schemas",
      writeOutput: vi.fn(),
    } satisfies InstallerCliRuntime;

    await expect(
      executeInstallerCommand(
        { dryRun: false, provider: "openai-compatible-http", type: "provider-set" },
        runtime,
      ),
    ).rejects.toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" });
    expect(write).not.toHaveBeenCalled();
  });
});

import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("compatible Provider selection before configuration CLI support", () => {
  it("fails closed without writing provider.json or invoking external operations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "huayi-compatible-cli-test-"));
    temporaryDirectories.push(directory);
    const configurationPath = join(directory, "provider.json");
    const providerConfigurationStore = new ProviderConfigurationStore(configurationPath);
    const write = vi.spyOn(providerConfigurationStore, "write");
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

    await expect(executeInstallerCommand(command, runtime)).rejects.toThrow(/compatible HTTP/i);

    expect(command).toMatchObject({ provider: "openai-compatible-http" });
    expect(write).not.toHaveBeenCalled();
    await expect(lstat(configurationPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      Object.values(operations).every((operation) => !vi.mocked(operation).mock.calls.length),
    ).toBe(true);
    expect(runtime.writeOutput).not.toHaveBeenCalled();
    expect(processRunner.run).not.toHaveBeenCalled();
    expect(runtime.interactiveProcessRunner.run).not.toHaveBeenCalled();
  });
});

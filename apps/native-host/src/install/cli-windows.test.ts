import { describe, expect, it, vi } from "vitest";

import type { InstallerCliOperations, InstallerCliRuntime } from "./cli.js";
import { executeInstallerCommand } from "./cli.js";

function createRuntime(output: string[]): InstallerCliRuntime {
  const operations: InstallerCliOperations = {
    configureEudic: vi.fn(),
    configureOpenAI: vi.fn(),
    install: vi.fn(),
    removeEudic: vi.fn(),
    removeOpenAI: vi.fn(),
    uninstall: vi.fn(),
  };
  return {
    compatibleCredentialOperations: {
      configureCompatible: vi.fn(),
      removeCompatible: vi.fn(),
    },
    compatibleHttpConfigurationStore: {
      read: vi.fn(),
      remove: vi.fn(),
      write: vi.fn(),
    },
    environment: {},
    homeDirectory: "C:\\Users\\Tester",
    interactiveProcessRunner: { run: vi.fn() },
    localAppDataDirectory: "C:\\Users\\Tester\\AppData\\Local",
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    nodeVersion: "26.1.0",
    operations,
    platform: "win32",
    processRunner: { run: vi.fn() },
    providerConfigurationStore: { read: vi.fn(), write: vi.fn() },
    securityExecutable: "",
    sourceBundlePath: "",
    sourceSchemaDirectory: "",
    writeOutput: (message) => output.push(message),
  };
}

describe("Windows installer CLI", () => {
  it("reports the fixed DeepSeek provider without reading a provider store", async () => {
    const output: string[] = [];
    const runtime = createRuntime(output);

    await executeInstallerCommand({ type: "provider-status" }, runtime);

    expect(output).toEqual(["deepseek-chat-completions"]);
    expect(runtime.providerConfigurationStore.read).not.toHaveBeenCalled();
  });

  it("rejects Codex and Eudic configuration in Windows mode", async () => {
    const runtime = createRuntime([]);

    await expect(
      executeInstallerCommand({ dryRun: false, provider: "codex", type: "provider-set" }, runtime),
    ).rejects.toThrow(/only.*DeepSeek/i);
    await expect(
      executeInstallerCommand({ dryRun: true, type: "eudic-configure" }, runtime),
    ).rejects.toThrow(/unavailable/i);
  });
});

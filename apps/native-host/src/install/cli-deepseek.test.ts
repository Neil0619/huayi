import { describe, expect, it, vi } from "vitest";

import type { ModelProvider } from "@huayi/protocol";

import {
  executeInstallerCommand,
  parseInstallerArguments,
  type InstallerCliRuntime,
} from "./cli.js";

function runtime() {
  const output: string[] = [];
  const configureDeepSeek = vi.fn(async () => ({
    actions: ["Configure DeepSeek credentials"],
    dryRun: false,
  }));
  const removeDeepSeek = vi.fn(async () => ({
    actions: ["Remove DeepSeek credentials"],
    dryRun: false,
  }));
  const selected: { provider: ModelProvider } = { provider: "codex" };
  const value: InstallerCliRuntime = {
    compatibleCredentialOperations: {
      configureCompatible: vi.fn(),
      removeCompatible: vi.fn(),
    },
    compatibleHttpConfigurationStore: {
      read: vi.fn(),
      remove: vi.fn(),
      write: vi.fn(),
    },
    deepSeekCredentialOperations: { configureDeepSeek, removeDeepSeek },
    environment: { HOME: "/Users/tester" },
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
    platform: "darwin",
    processRunner: { run: vi.fn() },
    providerConfigurationStore: {
      read: async () => selected.provider,
      write: async (provider, dryRun) => {
        selected.provider = provider;
        return { dryRun, provider };
      },
    },
    securityExecutable: "/usr/bin/security",
    sourceBundlePath: "/build/main.js",
    sourceSchemaDirectory: "/build/provider/schemas",
    writeOutput: (line) => output.push(line),
  };
  return { configureDeepSeek, output, removeDeepSeek, selected, value };
}

describe("DeepSeek installer CLI", () => {
  it("parses dedicated credential commands and the provider alias", () => {
    expect(parseInstallerArguments(["deepseek-configure"])).toEqual({
      dryRun: false,
      type: "deepseek-configure",
    });
    expect(parseInstallerArguments(["deepseek-remove", "--dry-run"])).toEqual({
      dryRun: true,
      type: "deepseek-remove",
    });
    expect(parseInstallerArguments(["provider-set", "deepseek"])).toEqual({
      dryRun: false,
      provider: "deepseek-chat-completions",
      type: "provider-set",
    });
  });

  it("configures credentials without selecting DeepSeek, then selects it explicitly", async () => {
    const fixture = runtime();

    await executeInstallerCommand({ dryRun: false, type: "deepseek-configure" }, fixture.value);
    expect(fixture.selected.provider).toBe("codex");
    expect(fixture.configureDeepSeek).toHaveBeenCalledOnce();

    await executeInstallerCommand(
      {
        dryRun: false,
        provider: "deepseek-chat-completions",
        type: "provider-set",
      },
      fixture.value,
    );
    expect(fixture.selected.provider).toBe("deepseek-chat-completions");
  });

  it("removes the exact DeepSeek credential before deleting host files", async () => {
    const fixture = runtime();
    const removeEudic = vi.mocked(fixture.value.operations.removeEudic).mockResolvedValue({
      actions: [],
      dryRun: false,
    });
    const removeOpenAI = vi.mocked(fixture.value.operations.removeOpenAI).mockResolvedValue({
      actions: [],
      dryRun: false,
    });
    const uninstall = vi.mocked(fixture.value.operations.uninstall).mockResolvedValue({
      actions: [],
      dryRun: false,
      paths: {} as never,
    });

    await executeInstallerCommand({ dryRun: false, type: "uninstall" }, fixture.value);

    expect(removeEudic).toHaveBeenCalledBefore(removeOpenAI);
    expect(removeOpenAI).toHaveBeenCalledBefore(fixture.removeDeepSeek);
    expect(fixture.removeDeepSeek).toHaveBeenCalledBefore(uninstall);
  });
});

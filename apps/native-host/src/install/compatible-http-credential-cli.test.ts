import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  executeInstallerCommand,
  parseInstallerArguments,
  type InstallerCliOperations,
  type InstallerCliRuntime,
} from "./cli.js";
import { createMacosInstallationPaths } from "./paths.js";

function createRuntime(): InstallerCliRuntime {
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
      configureCompatible: vi.fn().mockResolvedValue({
        actions: ["Configure compatible credentials"],
        dryRun: true,
      }),
      removeCompatible: vi.fn().mockResolvedValue({
        actions: ["Remove compatible credentials"],
        dryRun: false,
      }),
    },
    compatibleHttpConfigurationStore: {
      read: vi.fn(),
      remove: vi.fn(),
      write: vi.fn(),
    },
    environment: { HOME: "/Users/tester", PATH: "/usr/bin" },
    homeDirectory: "/Users/tester",
    interactiveProcessRunner: { run: vi.fn() },
    nodeExecutable: "/opt/node",
    nodeVersion: "20.19.0",
    operations,
    platform: "darwin",
    processRunner: { run: vi.fn() },
    providerConfigurationStore: { read: vi.fn(), write: vi.fn() },
    securityExecutable: "/tmp/legacy-security-must-not-reach-compatible-operations",
    sourceBundlePath: "/build/main.js",
    sourceSchemaDirectory: "/build/provider/schemas",
    writeOutput: vi.fn(),
  };
}

describe("compatible credential installer CLI", () => {
  it("parses only configure/remove with an optional --dry-run", () => {
    expect(parseInstallerArguments(["compatible-key-configure"])).toEqual({
      dryRun: false,
      type: "compatible-key-configure",
    });
    expect(parseInstallerArguments(["compatible-key-configure", "--dry-run"])).toEqual({
      dryRun: true,
      type: "compatible-key-configure",
    });
    expect(parseInstallerArguments(["compatible-key-remove"])).toEqual({
      dryRun: false,
      type: "compatible-key-remove",
    });
    expect(parseInstallerArguments(["compatible-key-remove", "--dry-run"])).toEqual({
      dryRun: true,
      type: "compatible-key-remove",
    });
  });

  it.each([
    ["compatible-key-configure", "--"],
    ["compatible-key-configure", "--unknown"],
    ["compatible-key-configure", "--dry-run", "extra"],
    ["compatible-key-remove", "--dry-run", "--dry-run"],
    ["compatible-key-remove", "-w", "test-compatible-key-sentinel"],
  ])("rejects unsupported compatible credential arguments: %j", (...arguments_) => {
    let error: unknown;
    try {
      parseInstallerArguments(arguments_);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("test-compatible-key-sentinel");
  });

  it("dispatches each command only to its dedicated compatible credential operation", async () => {
    const runtime = createRuntime();
    const unrelatedCompatibleConfig = vi.fn();
    const checkCodexCapabilities = vi.fn();
    const fetch = vi.fn();
    const runtimeWithUnrelatedDependencies = Object.assign(runtime, {
      checkCodexCapabilities,
      compatibleConfigurationOperation: unrelatedCompatibleConfig,
      fetch,
    });

    await executeInstallerCommand(
      parseInstallerArguments(["compatible-key-configure", "--dry-run"]),
      runtimeWithUnrelatedDependencies,
    );
    await executeInstallerCommand(
      parseInstallerArguments(["compatible-key-remove"]),
      runtimeWithUnrelatedDependencies,
    );

    expect(runtime.compatibleCredentialOperations.configureCompatible).toHaveBeenCalledWith({
      dryRun: true,
      environment: runtime.environment,
      homeDirectory: runtime.homeDirectory,
      interactiveProcessRunner: runtime.interactiveProcessRunner,
    });
    expect(runtime.compatibleCredentialOperations.removeCompatible).toHaveBeenCalledWith({
      dryRun: false,
      environment: runtime.environment,
      homeDirectory: runtime.homeDirectory,
      processRunner: runtime.processRunner,
    });
    expect(
      Object.values(runtime.operations).every(
        (operation) => !vi.mocked(operation).mock.calls.length,
      ),
    ).toBe(true);
    expect(runtime.providerConfigurationStore.read).not.toHaveBeenCalled();
    expect(runtime.providerConfigurationStore.write).not.toHaveBeenCalled();
    expect(unrelatedCompatibleConfig).not.toHaveBeenCalled();
    expect(checkCodexCapabilities).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(runtime.processRunner.run).not.toHaveBeenCalled();
    expect(runtime.interactiveProcessRunner.run).not.toHaveBeenCalled();
  });

  it("does not add compatible credential deletion to automatic uninstall", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.operations.removeEudic).mockResolvedValue({ actions: [], dryRun: false });
    vi.mocked(runtime.operations.removeOpenAI).mockResolvedValue({ actions: [], dryRun: false });
    vi.mocked(runtime.operations.uninstall).mockResolvedValue({
      actions: [],
      dryRun: false,
      paths: createMacosInstallationPaths("/Users/tester"),
    });

    await executeInstallerCommand({ dryRun: false, type: "uninstall" }, runtime);

    expect(runtime.compatibleCredentialOperations.configureCompatible).not.toHaveBeenCalled();
    expect(runtime.compatibleCredentialOperations.removeCompatible).not.toHaveBeenCalled();
  });

  it("exposes only the dedicated root scripts", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["host:compatible:key:configure"]).toBe(
      "node apps/native-host/dist/install/cli.js compatible-key-configure",
    );
    expect(packageJson.scripts?.["host:compatible:key:remove"]).toBe(
      "node apps/native-host/dist/install/cli.js compatible-key-remove",
    );
  });
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CompatibleHttpConfigurationStore } from "../config/compatible-http-configuration-store.js";
import { ProviderConfigurationStore } from "../config/provider-configuration-store.js";
import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  executeInstallerCommand,
  type InstallerCliOperations,
  type InstallerCliRuntime,
} from "./cli.js";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "huayi-cli-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function createRuntime(
  operations: InstallerCliOperations,
  output: string[],
  overrides: Partial<InstallerCliRuntime> = {},
): InstallerCliRuntime {
  const processRunner: ProcessRunner = { run: vi.fn() };
  return {
    compatibleCredentialOperations: {
      configureCompatible: vi.fn(),
      removeCompatible: vi.fn(),
    },
    compatibleHttpConfigurationStore: {
      read: vi.fn().mockResolvedValue({
        allowInsecureHttp: true,
        baseUrl: "http://101.133.153.118:9090/v1",
        effort: "low",
        model: "gpt-5.4-mini",
        schemaVersion: 1,
      }),
      remove: vi.fn(),
      write: vi.fn(),
    },
    environment: { HOME: "/Users/tester", PATH: "/usr/bin" },
    homeDirectory: "/Users/tester",
    nodeExecutable: "/opt/node",
    nodeVersion: "20.19.0",
    operations,
    platform: "darwin",
    processRunner,
    providerConfigurationStore: {
      read: vi.fn().mockResolvedValue("codex"),
      write: vi.fn().mockImplementation(async (provider, dryRun) => ({ dryRun, provider })),
    },
    sourceBundlePath: "/build/main.js",
    sourceSchemaDirectory: "/build/provider/schemas",
    securityExecutable: "/usr/bin/security",
    interactiveProcessRunner: { run: vi.fn() },
    writeOutput: (message) => output.push(message),
    ...overrides,
  };
}

describe.skipIf(process.platform === "win32")("executeInstallerCommand macOS mode", () => {
  it("updates compatible configuration without changing the selected provider", async () => {
    const directory = await createTemporaryDirectory();
    const providerStore = new ProviderConfigurationStore(join(directory, "provider.json"));
    const compatibleStore = new CompatibleHttpConfigurationStore(
      join(directory, "compatible-http.json"),
    );
    const runtime = createRuntime(
      {
        configureEudic: vi.fn(),
        configureOpenAI: vi.fn(),
        install: vi.fn(),
        removeEudic: vi.fn(),
        removeOpenAI: vi.fn(),
        uninstall: vi.fn(),
      },
      [],
      {
        compatibleHttpConfigurationStore: compatibleStore,
        providerConfigurationStore: providerStore,
      },
    );

    await executeInstallerCommand(
      {
        configuration: {
          allowInsecureHttp: true,
          baseUrl: "http://101.133.153.118:9090/v1",
          effort: "low",
          model: "gpt-5.4-mini",
          schemaVersion: 1,
        },
        dryRun: false,
        type: "compatible-config-set",
      },
      runtime,
    );

    await expect(providerStore.read()).resolves.toBe("codex");
    await expect(compatibleStore.read(new AbortController().signal)).resolves.toMatchObject({
      model: "gpt-5.4-mini",
    });
  });

  it("sets and reports providers without invoking installer, Keychain, or Codex operations", async () => {
    const output: string[] = [];
    const operations: InstallerCliOperations = {
      configureEudic: vi.fn(),
      configureOpenAI: vi.fn(),
      install: vi.fn(),
      removeEudic: vi.fn(),
      removeOpenAI: vi.fn(),
      uninstall: vi.fn(),
    };
    const write = vi.fn().mockResolvedValue({ dryRun: true, provider: "openai-responses" });
    const runtime = createRuntime(operations, output, {
      environment: { PATH: "" },
      providerConfigurationStore: { read: vi.fn(), write },
    });

    await executeInstallerCommand(
      { dryRun: true, provider: "openai-responses", type: "provider-set" },
      runtime,
    );

    expect(write).toHaveBeenCalledWith("openai-responses", true);
    expect(output).toEqual(["[dry-run] Set provider to openai-responses."]);
    expect(operations.configureEudic).not.toHaveBeenCalled();
    expect(operations.configureOpenAI).not.toHaveBeenCalled();
    expect(operations.install).not.toHaveBeenCalled();
    expect(operations.removeEudic).not.toHaveBeenCalled();
    expect(operations.removeOpenAI).not.toHaveBeenCalled();
    expect(operations.uninstall).not.toHaveBeenCalled();
    expect(runtime.processRunner.run).not.toHaveBeenCalled();
    expect(runtime.interactiveProcessRunner.run).not.toHaveBeenCalled();
  });

  it("rejects provider-set dry-runs when the existing target is invalid and leaves it untouched", async () => {
    const directory = await createTemporaryDirectory();
    const configurationPath = join(directory, "provider.json");
    const invalidContents = "{invalid-provider-secret\n";
    await writeFile(configurationPath, invalidContents, { encoding: "utf8", mode: 0o600 });
    const runtime = createRuntime(
      {
        configureEudic: vi.fn(),
        configureOpenAI: vi.fn(),
        install: vi.fn(),
        removeEudic: vi.fn(),
        removeOpenAI: vi.fn(),
        uninstall: vi.fn(),
      },
      [],
      { providerConfigurationStore: new ProviderConfigurationStore(configurationPath) },
    );

    await expect(
      executeInstallerCommand(
        { dryRun: true, provider: "openai-responses", type: "provider-set" },
        runtime,
      ),
    ).rejects.toThrow();
    expect(await readFile(configurationPath, "utf8")).toBe(invalidContents);
  });

  it("prints only the configured provider for provider status", async () => {
    const output: string[] = [];
    const operations: InstallerCliOperations = {
      configureEudic: vi.fn(),
      configureOpenAI: vi.fn(),
      install: vi.fn(),
      removeEudic: vi.fn(),
      removeOpenAI: vi.fn(),
      uninstall: vi.fn(),
    };
    const read = vi.fn().mockResolvedValue("openai-responses");
    const runtime = createRuntime(operations, output, {
      environment: { PATH: "" },
      providerConfigurationStore: { read, write: vi.fn() },
    });

    await executeInstallerCommand({ type: "provider-status" }, runtime);

    expect(read).toHaveBeenCalledOnce();
    expect(output).toEqual(["openai-responses"]);
    expect(operations.configureEudic).not.toHaveBeenCalled();
    expect(operations.configureOpenAI).not.toHaveBeenCalled();
    expect(operations.install).not.toHaveBeenCalled();
    expect(operations.removeEudic).not.toHaveBeenCalled();
    expect(operations.removeOpenAI).not.toHaveBeenCalled();
    expect(operations.uninstall).not.toHaveBeenCalled();
    expect(runtime.processRunner.run).not.toHaveBeenCalled();
    expect(runtime.interactiveProcessRunner.run).not.toHaveBeenCalled();
  });

  it("dispatches install and reports the returned action plan", async () => {
    const output: string[] = [];
    const install = vi.fn().mockResolvedValue({
      actions: ["Validate Codex", "Write manifest"],
      dryRun: true,
      paths: {},
    });
    const operations: InstallerCliOperations = {
      configureEudic: vi.fn(),
      configureOpenAI: vi.fn(),
      install,
      removeEudic: vi.fn(),
      removeOpenAI: vi.fn(),
      uninstall: vi.fn(),
    };
    const runtime = createRuntime(operations, output);

    await executeInstallerCommand(
      {
        codexPath: "/opt/codex",
        dryRun: true,
        extensionId: EXTENSION_ID,
        type: "install",
      },
      runtime,
    );

    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({
        codexExecutable: "/opt/codex",
        dryRun: true,
        extensionId: EXTENSION_ID,
        securityExecutable: "/usr/bin/security",
      }),
    );
    expect(output.join("\n")).toContain("[dry-run] Validate Codex");
    expect(output.join("\n")).toContain("[dry-run] Write manifest");
  });

  it("dispatches idempotent uninstall without looking up Codex", async () => {
    const output: string[] = [];
    const uninstall = vi.fn().mockResolvedValue({ actions: [], dryRun: false, paths: {} });
    const removeEudic = vi.fn().mockResolvedValue({ actions: [], dryRun: false });
    const removeOpenAI = vi.fn().mockResolvedValue({ actions: [], dryRun: false });
    const operations: InstallerCliOperations = {
      configureEudic: vi.fn(),
      configureOpenAI: vi.fn(),
      install: vi.fn(),
      removeEudic,
      removeOpenAI,
      uninstall,
    };

    await executeInstallerCommand(
      { dryRun: false, type: "uninstall" },
      createRuntime(operations, output, { environment: { PATH: "" } }),
    );

    expect(removeEudic).toHaveBeenCalledBefore(uninstall);
    expect(removeEudic).toHaveBeenCalledBefore(removeOpenAI);
    expect(removeOpenAI).toHaveBeenCalledBefore(uninstall);
    expect(uninstall).toHaveBeenCalledWith({ dryRun: false, homeDirectory: "/Users/tester" });
    expect(output).toEqual(["No installed Huayi files were found."]);
  });

  it("dispatches standalone Eudic and OpenAI configure and remove commands", async () => {
    const output: string[] = [];
    const configureEudic = vi
      .fn()
      .mockResolvedValue({ actions: ["Configure credentials"], dryRun: true });
    const removeEudic = vi
      .fn()
      .mockResolvedValue({ actions: ["Remove credentials"], dryRun: false });
    const configureOpenAI = vi
      .fn()
      .mockResolvedValue({ actions: ["Configure OpenAI credentials"], dryRun: true });
    const removeOpenAI = vi
      .fn()
      .mockResolvedValue({ actions: ["Remove OpenAI credentials"], dryRun: false });
    const operations: InstallerCliOperations = {
      configureEudic,
      configureOpenAI,
      install: vi.fn(),
      removeEudic,
      removeOpenAI,
      uninstall: vi.fn(),
    };
    const runtime = createRuntime(operations, output);

    await executeInstallerCommand({ dryRun: true, type: "eudic-configure" }, runtime);
    await executeInstallerCommand({ dryRun: false, type: "eudic-remove" }, runtime);
    await executeInstallerCommand({ dryRun: true, type: "openai-configure" }, runtime);
    await executeInstallerCommand({ dryRun: false, type: "openai-remove" }, runtime);

    expect(configureEudic).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
        securityExecutable: "/usr/bin/security",
      }),
    );
    expect(removeEudic).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: false,
        securityExecutable: "/usr/bin/security",
      }),
    );
    expect(configureOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
        securityExecutable: "/usr/bin/security",
      }),
    );
    expect(removeOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: false,
        securityExecutable: "/usr/bin/security",
      }),
    );
    expect(output).toEqual([
      "[dry-run] Configure credentials",
      "Remove credentials",
      "[dry-run] Configure OpenAI credentials",
      "Remove OpenAI credentials",
    ]);
  });

  it("preserves host files when Keychain deletion fails during uninstall", async () => {
    const failure = new Error("Keychain deletion failed");
    const removeEudic = vi.fn().mockRejectedValue(failure);
    const uninstall = vi.fn();
    const operations: InstallerCliOperations = {
      configureEudic: vi.fn(),
      configureOpenAI: vi.fn(),
      install: vi.fn(),
      removeEudic,
      removeOpenAI: vi.fn(),
      uninstall,
    };

    await expect(
      executeInstallerCommand({ dryRun: false, type: "uninstall" }, createRuntime(operations, [])),
    ).rejects.toBe(failure);

    expect(uninstall).not.toHaveBeenCalled();
    expect(operations.removeOpenAI).not.toHaveBeenCalled();
  });

  it("preserves host files when OpenAI Keychain deletion fails during uninstall", async () => {
    const failure = new Error("OpenAI Keychain deletion failed");
    const removeEudic = vi.fn().mockResolvedValue({ actions: [], dryRun: false });
    const removeOpenAI = vi.fn().mockRejectedValue(failure);
    const uninstall = vi.fn();
    const operations: InstallerCliOperations = {
      configureEudic: vi.fn(),
      configureOpenAI: vi.fn(),
      install: vi.fn(),
      removeEudic,
      removeOpenAI,
      uninstall,
    };

    await expect(
      executeInstallerCommand({ dryRun: false, type: "uninstall" }, createRuntime(operations, [])),
    ).rejects.toBe(failure);

    expect(removeEudic).toHaveBeenCalledBefore(removeOpenAI);
    expect(uninstall).not.toHaveBeenCalled();
  });

  it("rejects non-macOS execution before any operation", async () => {
    const operations: InstallerCliOperations = {
      configureEudic: vi.fn(),
      configureOpenAI: vi.fn(),
      install: vi.fn(),
      removeEudic: vi.fn(),
      removeOpenAI: vi.fn(),
      uninstall: vi.fn(),
    };

    await expect(
      executeInstallerCommand(
        { dryRun: false, type: "uninstall" },
        createRuntime(operations, [], { platform: "linux" }),
      ),
    ).rejects.toThrow(/macOS/i);
    expect(operations.uninstall).not.toHaveBeenCalled();
  });
});

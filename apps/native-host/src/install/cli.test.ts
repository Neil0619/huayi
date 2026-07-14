import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  executeInstallerCommand,
  parseInstallerArguments,
  resolveCodexExecutable,
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

describe("parseInstallerArguments", () => {
  it("parses install, uninstall, credential, and provider commands", () => {
    expect(
      parseInstallerArguments([
        "install",
        "--",
        "--extension-id",
        EXTENSION_ID,
        "--codex-path",
        "/opt/codex",
        "--dry-run",
      ]),
    ).toEqual({
      codexPath: "/opt/codex",
      dryRun: true,
      extensionId: EXTENSION_ID,
      type: "install",
    });
    expect(parseInstallerArguments(["uninstall", "--dry-run"])).toEqual({
      dryRun: true,
      type: "uninstall",
    });
    expect(parseInstallerArguments(["eudic-configure", "--", "--dry-run"])).toEqual({
      dryRun: true,
      type: "eudic-configure",
    });
    expect(parseInstallerArguments(["eudic-remove"])).toEqual({
      dryRun: false,
      type: "eudic-remove",
    });
    expect(parseInstallerArguments(["openai-configure", "--", "--dry-run"])).toEqual({
      dryRun: true,
      type: "openai-configure",
    });
    expect(parseInstallerArguments(["openai-remove"])).toEqual({
      dryRun: false,
      type: "openai-remove",
    });
    expect(parseInstallerArguments(["provider-set", "api", "--dry-run"])).toEqual({
      dryRun: true,
      provider: "openai-responses",
      type: "provider-set",
    });
    expect(parseInstallerArguments(["provider-set", "codex"])).toEqual({
      dryRun: false,
      provider: "codex",
      type: "provider-set",
    });
    expect(parseInstallerArguments(["provider-status"])).toEqual({ type: "provider-status" });
    expect(parseInstallerArguments(["--help"])).toEqual({ type: "help" });
  });

  it.each([
    [[]],
    [["install"]],
    [["install", "--extension-id"]],
    [["uninstall", "--extension-id", EXTENSION_ID]],
    [["install", "--extension-id", EXTENSION_ID, "--unknown"]],
    [["provider-set"]],
    [["provider-set", "openai-responses"]],
    [["provider-set", "--dry-run", "api"]],
    [["provider-set", "api", "--dry-run", "--dry-run"]],
    [["provider-set", "api", "--"]],
    [["provider-set", "api", "extra"]],
    [["provider-status", "--dry-run"]],
  ])("rejects invalid arguments %j", (arguments_) => {
    expect(() => parseInstallerArguments(arguments_)).toThrow(/usage|argument|extension|provider/i);
  });
});

describe("resolveCodexExecutable", () => {
  it("finds and canonicalizes an executable from PATH without a shell", async () => {
    const directory = await createTemporaryDirectory();
    const executable = join(directory, "codex");
    await writeFile(executable, "#!/bin/sh\n", "utf8");
    await chmod(executable, 0o755);

    await expect(resolveCodexExecutable(undefined, directory)).resolves.toBe(
      await realpath(executable),
    );
  });

  it("rejects missing and relative explicit paths", async () => {
    await expect(resolveCodexExecutable(undefined, "")).rejects.toThrow(/Codex CLI/i);
    await expect(resolveCodexExecutable("bin/codex", "/usr/bin")).rejects.toThrow(/absolute/i);
  });
});

function createRuntime(
  operations: InstallerCliOperations,
  output: string[],
  overrides: Partial<InstallerCliRuntime> = {},
): InstallerCliRuntime {
  const processRunner: ProcessRunner = { run: vi.fn() };
  return {
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

describe("executeInstallerCommand", () => {
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

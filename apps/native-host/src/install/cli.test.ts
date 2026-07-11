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
  it("parses install, uninstall, dry-run, and an explicit Codex path", () => {
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
    expect(parseInstallerArguments(["--help"])).toEqual({ type: "help" });
  });

  it.each([
    [[]],
    [["install"]],
    [["install", "--extension-id"]],
    [["uninstall", "--extension-id", EXTENSION_ID]],
    [["install", "--extension-id", EXTENSION_ID, "--unknown"]],
  ])("rejects invalid arguments %j", (arguments_) => {
    expect(() => parseInstallerArguments(arguments_)).toThrow(/usage|argument|extension/i);
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
    sourceBundlePath: "/build/main.js",
    sourceSchemaDirectory: "/build/provider/schemas",
    writeOutput: (message) => output.push(message),
    ...overrides,
  };
}

describe("executeInstallerCommand", () => {
  it("dispatches install and reports the returned action plan", async () => {
    const output: string[] = [];
    const install = vi.fn().mockResolvedValue({
      actions: ["Validate Codex", "Write manifest"],
      dryRun: true,
      paths: {},
    });
    const operations: InstallerCliOperations = {
      install,
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
      }),
    );
    expect(output.join("\n")).toContain("[dry-run] Validate Codex");
    expect(output.join("\n")).toContain("[dry-run] Write manifest");
  });

  it("dispatches idempotent uninstall without looking up Codex", async () => {
    const output: string[] = [];
    const uninstall = vi.fn().mockResolvedValue({ actions: [], dryRun: false, paths: {} });
    const operations: InstallerCliOperations = { install: vi.fn(), uninstall };

    await executeInstallerCommand(
      { dryRun: false, type: "uninstall" },
      createRuntime(operations, output, { environment: { PATH: "" } }),
    );

    expect(uninstall).toHaveBeenCalledWith({ dryRun: false, homeDirectory: "/Users/tester" });
    expect(output).toEqual(["No installed Huayi files were found."]);
  });

  it("rejects non-macOS execution before any operation", async () => {
    const operations: InstallerCliOperations = { install: vi.fn(), uninstall: vi.fn() };

    await expect(
      executeInstallerCommand(
        { dryRun: false, type: "uninstall" },
        createRuntime(operations, [], { platform: "linux" }),
      ),
    ).rejects.toThrow(/macOS/i);
    expect(operations.uninstall).not.toHaveBeenCalled();
  });
});

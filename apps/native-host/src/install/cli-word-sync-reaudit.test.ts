import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  executeInstallerCommand,
  type InstallerCliOperations,
  type InstallerCliRuntime,
} from "./cli.js";
import { resolveWordSyncReauditStatePath } from "./word-sync-reaudit-cli.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "huayi-reaudit-cli-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createRuntime(homeDirectory: string, output: string[]): InstallerCliRuntime {
  const operations: InstallerCliOperations = {
    configureEudic: vi.fn(),
    configureOpenAI: vi.fn(),
    install: vi.fn(),
    removeEudic: vi.fn(),
    removeOpenAI: vi.fn(),
    uninstall: vi.fn(),
  };
  const processRunner: ProcessRunner = { run: vi.fn() };
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
    environment: { HOME: homeDirectory, PATH: "/usr/bin" },
    homeDirectory,
    interactiveProcessRunner: { run: vi.fn() },
    nodeExecutable: "/opt/node",
    nodeVersion: "20.19.0",
    operations,
    platform: "darwin",
    processRunner,
    providerConfigurationStore: {
      read: vi.fn(),
      write: vi.fn(),
    },
    securityExecutable: "/usr/bin/security",
    sourceBundlePath: "/build/main.js",
    sourceSchemaDirectory: "/build/provider/schemas",
    writeOutput: (message) => output.push(message),
  };
}

describe("word-sync re-audit installer command", () => {
  it.skipIf(process.platform === "win32")(
    "runs a macOS dry-run against the owned state path",
    async () => {
      const homeDirectory = await createTemporaryDirectory();
      const stateDirectory = join(
        homeDirectory,
        "Library",
        "Application Support",
        "Huayi",
        "native-host",
      );
      await mkdir(stateDirectory, { recursive: true });
      await writeFile(
        join(stateDirectory, "word-sync-state.json"),
        JSON.stringify({
          activeBatch: null,
          completedKeys: ["legacy"],
          historyComplete: true,
          lastErrorCode: null,
          lastPollSucceeded: true,
          lastSuccessfulPollAt: "2026-07-22T01:00:00.000Z",
          pending: [],
          scan: null,
          skippedCount: 0,
          skippedKeys: [],
          stateVersion: 1,
        }),
        { mode: 0o600 },
      );
      const output: string[] = [];

      await executeInstallerCommand(
        { confirm: false, type: "word-sync-reaudit" },
        createRuntime(homeDirectory, output),
      );

      expect(output).toEqual(["[dry-run] 1 legacy word is eligible for re-audit."]);
    },
  );

  it("selects the Windows state path below LOCALAPPDATA", () => {
    const localAppDataDirectory = "C:\\Users\\Tester\\AppData\\Local";

    expect(
      resolveWordSyncReauditStatePath({
        homeDirectory: "C:\\Users\\Tester",
        localAppDataDirectory,
        platform: "win32",
      }),
    ).toBe(win32.join(localAppDataDirectory, "Huayi", "native-host", "word-sync-state.json"));
  });

  it.skipIf(process.platform !== "win32")(
    "runs a Windows dry-run against the owned state path",
    async () => {
      const localAppDataDirectory = await createTemporaryDirectory();
      const stateDirectory = win32.join(localAppDataDirectory, "Huayi", "native-host");
      await mkdir(stateDirectory, { recursive: true });
      const statePath = win32.join(stateDirectory, "word-sync-state.json");
      const originalState = JSON.stringify({
        activeBatch: null,
        completedKeys: ["legacy"],
        historyComplete: true,
        lastErrorCode: null,
        lastPollSucceeded: true,
        lastSuccessfulPollAt: "2026-07-22T01:00:00.000Z",
        pending: [],
        scan: null,
        skippedCount: 0,
        skippedKeys: [],
        stateVersion: 1,
      });
      await writeFile(statePath, originalState, { mode: 0o600 });
      const output: string[] = [];
      const runtime = createRuntime("C:\\Users\\Tester", output);

      await executeInstallerCommand(
        { confirm: false, type: "word-sync-reaudit" },
        {
          ...runtime,
          localAppDataDirectory,
          platform: "win32",
        },
      );

      expect(output).toEqual(["[dry-run] 1 legacy word is eligible for re-audit."]);
      expect(await readFile(statePath, "utf8")).toBe(originalState);
      for (const suffix of [".backup", ".v1-snapshot", ".v2-snapshot"]) {
        await expect(access(`${statePath}${suffix}`)).rejects.toMatchObject({ code: "ENOENT" });
      }
    },
  );
});

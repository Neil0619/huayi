import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  createWindowsRegistryAddArguments,
  installWindowsNativeHost,
  uninstallWindowsNativeHost,
  WINDOWS_NATIVE_HOST_REGISTRY_KEY,
  type InstallWindowsNativeHostOptions,
} from "./windows.js";
import { createWindowsInstallationPaths } from "./windows-paths.js";

const temporaryDirectories: string[] = [];
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

async function createInstallerFixture() {
  const root = await mkdtemp(join(tmpdir(), "huayi-windows-installer-"));
  temporaryDirectories.push(root);
  const source = join(root, "source");
  const localAppDataDirectory = join(root, "local-app-data");
  const executable = join(source, "huayi-native-host.exe");
  const deepSeekHelper = join(source, "deepseek-credential.ps1");
  const eudicHelper = join(source, "eudic-credential.ps1");
  const schemas = join(source, "schemas");
  await mkdir(schemas, { recursive: true });
  await mkdir(localAppDataDirectory, { recursive: true });
  await writeFile(executable, "executable-v1", "utf8");
  await writeFile(deepSeekHelper, "deepseek-helper-v1", "utf8");
  await writeFile(eudicHelper, "eudic-helper-v1", "utf8");
  await writeFile(join(schemas, "translate-word.json"), '{"version":1}', "utf8");
  if (process.platform !== "win32") await chmod(executable, 0o755);
  const run = vi.fn<ProcessRunner["run"]>(async () => ({
    exitCode: 0,
    signal: null,
    stderr: "",
    stdout: "",
  }));
  const options: InstallWindowsNativeHostOptions = {
    dryRun: false,
    environment: { LOCALAPPDATA: localAppDataDirectory },
    extensionId: EXTENSION_ID,
    localAppDataDirectory,
    processRunner: { run },
    registryExecutable: "C:\\Windows\\System32\\reg.exe",
    sourceDeepSeekCredentialHelperPath: deepSeekHelper,
    sourceEudicCredentialHelperPath: eudicHelper,
    sourceExecutablePath: executable,
    sourceSchemaDirectory: schemas,
  };
  return {
    deepSeekHelper,
    eudicHelper,
    executable,
    localAppDataDirectory,
    options,
    paths: createWindowsInstallationPaths(localAppDataDirectory),
    run,
    schemas,
  };
}

describe("Windows Native Host installation", () => {
  it("validates a DeepSeek and Eudic package without writing or invoking the registry", async () => {
    const source = await mkdtemp(join(tmpdir(), "huayi-windows-source-"));
    temporaryDirectories.push(source);
    const executable = join(source, "huayi-native-host.exe");
    const deepSeekHelper = join(source, "deepseek-credential.ps1");
    const eudicHelper = join(source, "eudic-credential.ps1");
    const schemas = join(source, "schemas");
    await mkdir(schemas);
    await writeFile(executable, "fake executable", "utf8");
    await writeFile(deepSeekHelper, "# DeepSeek helper", "utf8");
    await writeFile(eudicHelper, "# Eudic helper", "utf8");
    await writeFile(join(schemas, "translate-word.json"), "{}", "utf8");
    await chmod(executable, 0o755);
    const run = vi.fn();

    const result = await installWindowsNativeHost({
      dryRun: true,
      environment: { LOCALAPPDATA: "C:\\Users\\Tester\\AppData\\Local" },
      extensionId: EXTENSION_ID,
      localAppDataDirectory: "C:\\Users\\Tester\\AppData\\Local",
      processRunner: { run },
      registryExecutable: "C:\\Windows\\System32\\reg.exe",
      sourceDeepSeekCredentialHelperPath: deepSeekHelper,
      sourceEudicCredentialHelperPath: eudicHelper,
      sourceExecutablePath: executable,
      sourceSchemaDirectory: schemas,
    });

    expect(result.dryRun).toBe(true);
    expect(result.actions.join(" ")).toContain("DeepSeek and Eudic");
    expect(result.actions).toContain(`Authorize Chrome extension ${EXTENSION_ID}`);
    expect(run).not.toHaveBeenCalled();
  });

  it("uses the exact per-user Chrome Native Messaging registry value", () => {
    expect(createWindowsRegistryAddArguments("C:\\Huayi\\host.json")).toEqual([
      "ADD",
      WINDOWS_NATIVE_HOST_REGISTRY_KEY,
      "/ve",
      "/t",
      "REG_SZ",
      "/d",
      "C:\\Huayi\\host.json",
      "/f",
    ]);
    expect(WINDOWS_NATIVE_HOST_REGISTRY_KEY).toBe(
      "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.huayi.codex_bridge",
    );
  });
});

describe.skipIf(process.platform !== "win32")("Windows Native Host filesystem integration", () => {
  it("copies runtime files, writes the exact manifest, and registers the exact HKCU value", async () => {
    const fixture = await createInstallerFixture();

    const result = await installWindowsNativeHost(fixture.options);

    expect(result.dryRun).toBe(false);
    await expect(readFile(fixture.paths.executablePath, "utf8")).resolves.toBe("executable-v1");
    await expect(readFile(fixture.paths.deepSeekCredentialHelperPath, "utf8")).resolves.toBe(
      "deepseek-helper-v1",
    );
    await expect(readFile(fixture.paths.eudicCredentialHelperPath, "utf8")).resolves.toBe(
      "eudic-helper-v1",
    );
    await expect(
      readFile(join(fixture.paths.schemaDirectory, "translate-word.json"), "utf8"),
    ).resolves.toBe('{"version":1}');
    await expect(readFile(fixture.paths.ownershipMarkerPath, "utf8")).resolves.toBe(
      "com.huayi.codex_bridge\n",
    );
    await expect(readFile(fixture.paths.nativeManifestPath, "utf8")).resolves.toBe(
      `${JSON.stringify(
        {
          allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
          description: "Huayi Native Messaging bridge",
          name: "com.huayi.codex_bridge",
          path: fixture.paths.executablePath,
          type: "stdio",
        },
        null,
        2,
      )}\n`,
    );
    expect(fixture.run).toHaveBeenCalledExactlyOnceWith({
      arguments: createWindowsRegistryAddArguments(fixture.paths.nativeManifestPath),
      cwd: fixture.paths.applicationDirectory,
      env: fixture.options.environment,
      executable: fixture.options.registryExecutable,
      input: "",
      maximumOutputBytes: 8192,
      timeoutMs: 5000,
    });
  });

  it("replaces owned runtime files while preserving credentials and word-sync state", async () => {
    const fixture = await createInstallerFixture();
    await installWindowsNativeHost(fixture.options);
    await writeFile(fixture.paths.deepSeekCredentialPath, "deepseek-secret", "utf8");
    await writeFile(fixture.paths.eudicCredentialPath, "eudic-secret", "utf8");
    await writeFile(fixture.paths.wordSyncStatePath, "word-sync-state", "utf8");
    await writeFile(join(fixture.paths.schemaDirectory, "stale.json"), "stale", "utf8");
    await writeFile(fixture.executable, "executable-v2", "utf8");
    await writeFile(fixture.deepSeekHelper, "deepseek-helper-v2", "utf8");
    await writeFile(fixture.eudicHelper, "eudic-helper-v2", "utf8");
    await writeFile(join(fixture.schemas, "translate-word.json"), '{"version":2}', "utf8");

    await installWindowsNativeHost(fixture.options);

    await expect(readFile(fixture.paths.executablePath, "utf8")).resolves.toBe("executable-v2");
    await expect(readFile(fixture.paths.deepSeekCredentialHelperPath, "utf8")).resolves.toBe(
      "deepseek-helper-v2",
    );
    await expect(readFile(fixture.paths.eudicCredentialHelperPath, "utf8")).resolves.toBe(
      "eudic-helper-v2",
    );
    await expect(readFile(fixture.paths.deepSeekCredentialPath, "utf8")).resolves.toBe(
      "deepseek-secret",
    );
    await expect(readFile(fixture.paths.eudicCredentialPath, "utf8")).resolves.toBe("eudic-secret");
    await expect(readFile(fixture.paths.wordSyncStatePath, "utf8")).resolves.toBe(
      "word-sync-state",
    );
    await expect(
      readFile(join(fixture.paths.schemaDirectory, "translate-word.json"), "utf8"),
    ).resolves.toBe('{"version":2}');
    await expectMissing(join(fixture.paths.schemaDirectory, "stale.json"));
  });

  it.each([
    ["missing", undefined],
    ["invalid", "not-huayi\n"],
  ])("refuses an existing %s ownership marker before modifying files", async (_, marker) => {
    const fixture = await createInstallerFixture();
    await mkdir(fixture.paths.applicationDirectory, { recursive: true });
    await writeFile(join(fixture.paths.applicationDirectory, "sentinel.txt"), "preserve", "utf8");
    if (marker !== undefined) {
      await writeFile(fixture.paths.ownershipMarkerPath, marker, "utf8");
    }

    await expect(installWindowsNativeHost(fixture.options)).rejects.toThrow(/ownership/i);

    await expect(
      readFile(join(fixture.paths.applicationDirectory, "sentinel.txt"), "utf8"),
    ).resolves.toBe("preserve");
    expect(fixture.run).not.toHaveBeenCalled();
  });

  it("removes the exact registration and owned directory while preserving sibling paths", async () => {
    const fixture = await createInstallerFixture();
    await installWindowsNativeHost(fixture.options);
    fixture.run.mockClear();
    const siblingPath = join(fixture.localAppDataDirectory, "Huayi", "keep.txt");
    await writeFile(siblingPath, "preserve", "utf8");

    const result = await uninstallWindowsNativeHost({
      dryRun: false,
      environment: fixture.options.environment,
      localAppDataDirectory: fixture.localAppDataDirectory,
      processRunner: { run: fixture.run },
      registryExecutable: fixture.options.registryExecutable,
    });

    expect(result.actions).toEqual([
      `Remove ${WINDOWS_NATIVE_HOST_REGISTRY_KEY}`,
      `Remove Windows Huayi directory ${fixture.paths.applicationDirectory}`,
    ]);
    expect(fixture.run).toHaveBeenNthCalledWith(1, {
      arguments: ["QUERY", WINDOWS_NATIVE_HOST_REGISTRY_KEY, "/ve"],
      cwd: fixture.paths.applicationDirectory,
      env: fixture.options.environment,
      executable: fixture.options.registryExecutable,
      input: "",
      maximumOutputBytes: 8192,
      timeoutMs: 5000,
    });
    expect(fixture.run).toHaveBeenNthCalledWith(2, {
      arguments: ["DELETE", WINDOWS_NATIVE_HOST_REGISTRY_KEY, "/f"],
      cwd: fixture.paths.applicationDirectory,
      env: fixture.options.environment,
      executable: fixture.options.registryExecutable,
      input: "",
      maximumOutputBytes: 8192,
      timeoutMs: 5000,
    });
    await expectMissing(fixture.paths.applicationDirectory);
    await expect(readFile(siblingPath, "utf8")).resolves.toBe("preserve");
  });

  it("removes owned files when the exact registry value is already absent", async () => {
    const fixture = await createInstallerFixture();
    await installWindowsNativeHost(fixture.options);
    fixture.run.mockReset();
    fixture.run.mockResolvedValue({ exitCode: 1, signal: null, stderr: "", stdout: "" });

    await uninstallWindowsNativeHost({
      dryRun: false,
      environment: fixture.options.environment,
      localAppDataDirectory: fixture.localAppDataDirectory,
      processRunner: { run: fixture.run },
      registryExecutable: fixture.options.registryExecutable,
    });

    expect(fixture.run).toHaveBeenCalledOnce();
    await expectMissing(fixture.paths.applicationDirectory);
  });

  it("removes an orphaned exact registry value when the owned directory is already absent", async () => {
    const fixture = await createInstallerFixture();
    fixture.run.mockResolvedValue({ exitCode: 0, signal: null, stderr: "", stdout: "" });

    const result = await uninstallWindowsNativeHost({
      dryRun: false,
      environment: fixture.options.environment,
      localAppDataDirectory: fixture.localAppDataDirectory,
      processRunner: { run: fixture.run },
      registryExecutable: fixture.options.registryExecutable,
    });

    expect(result.actions).toEqual([`Remove ${WINDOWS_NATIVE_HOST_REGISTRY_KEY}`]);
    expect(fixture.run).toHaveBeenCalledTimes(2);
    expect(fixture.run.mock.calls[0]?.[0]).toMatchObject({
      arguments: ["QUERY", WINDOWS_NATIVE_HOST_REGISTRY_KEY, "/ve"],
      cwd: fixture.localAppDataDirectory,
    });
    expect(fixture.run.mock.calls[1]?.[0]).toMatchObject({
      arguments: ["DELETE", WINDOWS_NATIVE_HOST_REGISTRY_KEY, "/f"],
      cwd: fixture.localAppDataDirectory,
    });
  });

  it.each([
    [{ exitCode: 2, signal: null, stderr: "failed", stdout: "" }],
    [{ exitCode: 0, signal: "SIGTERM" as const, stderr: "", stdout: "" }],
  ])("fails closed when registry inspection fails and preserves owned files", async (query) => {
    const fixture = await createInstallerFixture();
    await installWindowsNativeHost(fixture.options);
    fixture.run.mockReset();
    fixture.run.mockResolvedValue(query);

    await expect(
      uninstallWindowsNativeHost({
        dryRun: false,
        environment: fixture.options.environment,
        localAppDataDirectory: fixture.localAppDataDirectory,
        processRunner: { run: fixture.run },
        registryExecutable: fixture.options.registryExecutable,
      }),
    ).rejects.toThrow(/inspect/i);

    await expect(readFile(fixture.paths.ownershipMarkerPath, "utf8")).resolves.toBe(
      "com.huayi.codex_bridge\n",
    );
  });

  it("is idempotent when both the exact registry value and owned directory are absent", async () => {
    const fixture = await createInstallerFixture();
    fixture.run.mockResolvedValue({ exitCode: 1, signal: null, stderr: "", stdout: "" });

    const result = await uninstallWindowsNativeHost({
      dryRun: false,
      environment: fixture.options.environment,
      localAppDataDirectory: fixture.localAppDataDirectory,
      processRunner: { run: fixture.run },
      registryExecutable: fixture.options.registryExecutable,
    });

    expect(result.actions).toEqual([]);
    expect(fixture.run).toHaveBeenCalledOnce();
  });
});

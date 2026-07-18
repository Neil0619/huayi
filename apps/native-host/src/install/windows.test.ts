import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWindowsRegistryAddArguments,
  installWindowsNativeHost,
  WINDOWS_NATIVE_HOST_REGISTRY_KEY,
} from "./windows.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

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
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
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

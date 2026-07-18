import { constants } from "node:fs";
import { access, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ProcessRunner } from "../runtime/codex-process.js";
import { createNativeHostManifest, NATIVE_HOST_NAME } from "./native-manifest.js";
import { createWindowsInstallationPaths, type WindowsInstallationPaths } from "./windows-paths.js";

const OWNERSHIP_MARKER = `${NATIVE_HOST_NAME}\n`;
export const WINDOWS_NATIVE_HOST_REGISTRY_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;

export interface InstallWindowsNativeHostOptions {
  readonly dryRun: boolean;
  readonly environment: NodeJS.ProcessEnv;
  readonly extensionId: string;
  readonly localAppDataDirectory: string;
  readonly processRunner: ProcessRunner;
  readonly registryExecutable: string;
  readonly sourceCredentialHelperPath: string;
  readonly sourceExecutablePath: string;
  readonly sourceSchemaDirectory: string;
}

export interface UninstallWindowsNativeHostOptions {
  readonly dryRun: boolean;
  readonly environment: NodeJS.ProcessEnv;
  readonly localAppDataDirectory: string;
  readonly processRunner: ProcessRunner;
  readonly registryExecutable: string;
}

export interface WindowsInstallerResult {
  readonly actions: readonly string[];
  readonly dryRun: boolean;
  readonly paths: WindowsInstallationPaths;
}

async function requireReadable(path: string, label: string): Promise<void> {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`${label} is missing. Run pnpm host:windows:package first.`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertOwnedDirectory(paths: WindowsInstallationPaths): Promise<void> {
  if (!(await pathExists(paths.applicationDirectory))) return;
  if (!(await pathExists(paths.ownershipMarkerPath))) {
    throw new Error("Refusing to modify a Windows directory without Huayi ownership metadata.");
  }
  const marker = await readFile(paths.ownershipMarkerPath, "utf8");
  if (marker !== OWNERSHIP_MARKER) throw new Error("Huayi ownership metadata is invalid.");
  const information = await stat(paths.applicationDirectory);
  if (!information.isDirectory()) throw new Error("Huayi Windows installation path is invalid.");
}

async function updateRegistry(
  options: Pick<
    InstallWindowsNativeHostOptions,
    "environment" | "processRunner" | "registryExecutable"
  >,
  manifestPath: string,
): Promise<void> {
  const result = await options.processRunner.run({
    arguments: createWindowsRegistryAddArguments(manifestPath),
    cwd: dirname(manifestPath),
    env: options.environment,
    executable: options.registryExecutable,
    input: "",
    maximumOutputBytes: 8 * 1024,
    timeoutMs: 5_000,
  });
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new Error("Unable to register the Huayi Native Messaging host for Chrome.");
  }
}

export function createWindowsRegistryAddArguments(manifestPath: string): readonly string[] {
  return ["ADD", WINDOWS_NATIVE_HOST_REGISTRY_KEY, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"];
}

export async function installWindowsNativeHost(
  options: InstallWindowsNativeHostOptions,
): Promise<WindowsInstallerResult> {
  const paths = createWindowsInstallationPaths(options.localAppDataDirectory);
  await Promise.all([
    requireReadable(options.sourceExecutablePath, "Windows Host executable"),
    requireReadable(options.sourceCredentialHelperPath, "Windows credential helper"),
    requireReadable(options.sourceSchemaDirectory, "Provider schema directory"),
  ]);
  await assertOwnedDirectory(paths);
  const actions = [
    `Install Windows DeepSeek-only Host at ${paths.executablePath}`,
    `Register ${WINDOWS_NATIVE_HOST_REGISTRY_KEY}`,
  ];
  if (options.dryRun) return { actions, dryRun: true, paths };

  await mkdir(paths.applicationDirectory, { recursive: true });
  await writeFile(paths.ownershipMarkerPath, OWNERSHIP_MARKER, "utf8");
  await cp(options.sourceExecutablePath, paths.executablePath, { force: true });
  await cp(options.sourceCredentialHelperPath, paths.credentialHelperPath, { force: true });
  await rm(paths.schemaDirectory, { force: true, recursive: true });
  await mkdir(dirname(paths.schemaDirectory), { recursive: true });
  await cp(options.sourceSchemaDirectory, paths.schemaDirectory, { recursive: true });
  await mkdir(paths.workingDirectory, { recursive: true });
  await writeFile(
    paths.nativeManifestPath,
    `${JSON.stringify(createNativeHostManifest(options.extensionId, paths.executablePath), null, 2)}\n`,
    "utf8",
  );
  await updateRegistry(options, paths.nativeManifestPath);
  return { actions, dryRun: false, paths };
}

export async function uninstallWindowsNativeHost(
  options: UninstallWindowsNativeHostOptions,
): Promise<WindowsInstallerResult> {
  const paths = createWindowsInstallationPaths(options.localAppDataDirectory);
  if (!(await pathExists(paths.applicationDirectory))) {
    return { actions: [], dryRun: options.dryRun, paths };
  }
  await assertOwnedDirectory(paths);
  const actions = [
    `Remove ${WINDOWS_NATIVE_HOST_REGISTRY_KEY}`,
    `Remove Windows Huayi directory ${paths.applicationDirectory}`,
  ];
  if (options.dryRun) return { actions, dryRun: true, paths };
  const query = await options.processRunner.run({
    arguments: ["QUERY", WINDOWS_NATIVE_HOST_REGISTRY_KEY, "/ve"],
    cwd: paths.applicationDirectory,
    env: options.environment,
    executable: options.registryExecutable,
    input: "",
    maximumOutputBytes: 8 * 1024,
    timeoutMs: 5_000,
  });
  if (query.exitCode !== 0 && query.exitCode !== 1) {
    throw new Error("Unable to inspect the Huayi Chrome Native Messaging registration.");
  }
  if (query.exitCode === 0) {
    const deletion = await options.processRunner.run({
      arguments: ["DELETE", WINDOWS_NATIVE_HOST_REGISTRY_KEY, "/f"],
      cwd: paths.applicationDirectory,
      env: options.environment,
      executable: options.registryExecutable,
      input: "",
      maximumOutputBytes: 8 * 1024,
      timeoutMs: 5_000,
    });
    if (deletion.exitCode !== 0 || deletion.signal !== null) {
      throw new Error("Unable to remove the Huayi Chrome Native Messaging registration.");
    }
  }
  await rm(paths.applicationDirectory, { recursive: true });
  return { actions, dryRun: false, paths };
}

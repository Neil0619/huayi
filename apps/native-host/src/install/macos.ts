import { constants } from "node:fs";
import { access, chmod, copyFile, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { checkCodexCapabilities } from "../runtime/codex-capabilities.js";
import type { ProcessRunner } from "../runtime/codex-process.js";
import { createNativeHostManifest, NATIVE_HOST_NAME } from "./native-manifest.js";
import { createMacosInstallationPaths, type MacosInstallationPaths } from "./paths.js";

const OUTPUT_SCHEMA_NAMES = [
  "explain-lexical.json",
  "explain-sentence.json",
  "translate-lexical.json",
  "translate-passage.json",
] as const;
const OWNERSHIP_MARKER = `${JSON.stringify({ name: NATIVE_HOST_NAME, version: 1 })}\n`;

export interface InstallMacosNativeHostOptions {
  codexExecutable: string;
  dryRun: boolean;
  environment: NodeJS.ProcessEnv;
  extensionId: string;
  homeDirectory: string;
  nodeExecutable: string;
  nodeVersion: string;
  processRunner: ProcessRunner;
  sourceBundlePath: string;
  sourceSchemaDirectory: string;
}

export interface UninstallMacosNativeHostOptions {
  dryRun: boolean;
  homeDirectory: string;
}

export interface InstallerResult {
  actions: readonly string[];
  dryRun: boolean;
  paths: MacosInstallationPaths;
}

export interface LauncherScriptOptions {
  bundlePath: string;
  codexExecutable: string;
  codexHome?: string;
  homeDirectory: string;
  nodeExecutable: string;
  schemaDirectory: string;
  workingDirectory: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function renderLauncherScript(options: LauncherScriptOptions): string {
  const pathEnvironment = [
    dirname(options.nodeExecutable),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
  return [
    "#!/bin/sh",
    "set -eu",
    `export PATH=${shellQuote(pathEnvironment)}`,
    `export HOME=${shellQuote(options.homeDirectory)}`,
    ...(options.codexHome === undefined
      ? []
      : [`export CODEX_HOME=${shellQuote(options.codexHome)}`]),
    `export HUAYI_CODEX_PATH=${shellQuote(options.codexExecutable)}`,
    `export HUAYI_WORK_DIR=${shellQuote(options.workingDirectory)}`,
    `export HUAYI_SCHEMA_DIR=${shellQuote(options.schemaDirectory)}`,
    `exec ${shellQuote(options.nodeExecutable)} ${shellQuote(options.bundlePath)} "$@"`,
    "",
  ].join("\n");
}

function assertAbsolutePath(path: string, name: string): void {
  if (!isAbsolute(path)) {
    throw new TypeError(`${name} must be an absolute path.`);
  }
}

function assertSupportedNodeVersion(version: string): void {
  const match = /^v?(\d+)(?:\.|$)/u.exec(version.trim());
  const major = match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(major) || major < 18) {
    throw new Error("Node.js 18 or newer is required.");
  }
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function readStats(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

async function requireRegularSourceFile(path: string, name: string): Promise<void> {
  const stats = await readStats(path);
  if (stats === null || !stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${name} must be a regular file.`);
  }
  await access(path, constants.R_OK);
}

async function validateSources(options: InstallMacosNativeHostOptions): Promise<void> {
  assertAbsolutePath(options.codexExecutable, "Codex executable");
  assertAbsolutePath(options.nodeExecutable, "Node executable");
  assertAbsolutePath(options.sourceBundlePath, "Host bundle");
  assertAbsolutePath(options.sourceSchemaDirectory, "Schema directory");
  if (options.environment.CODEX_HOME !== undefined) {
    assertAbsolutePath(options.environment.CODEX_HOME, "Codex home directory");
  }
  await access(options.codexExecutable, constants.X_OK);
  await access(options.nodeExecutable, constants.X_OK);
  await requireRegularSourceFile(options.sourceBundlePath, "Host bundle");

  const schemaStats = await readStats(options.sourceSchemaDirectory);
  if (schemaStats === null || !schemaStats.isDirectory() || schemaStats.isSymbolicLink()) {
    throw new Error("Schema directory must be a regular directory.");
  }
  await Promise.all(
    OUTPUT_SCHEMA_NAMES.map((name) =>
      requireRegularSourceFile(join(options.sourceSchemaDirectory, name), `Schema ${name}`),
    ),
  );
}

async function validateOwnedApplication(paths: MacosInstallationPaths): Promise<boolean> {
  const applicationStats = await readStats(paths.applicationDirectory);
  if (applicationStats === null) {
    return false;
  }
  if (!applicationStats.isDirectory() || applicationStats.isSymbolicLink()) {
    throw new Error("Huayi application path is not an owned directory.");
  }

  const markerStats = await readStats(paths.ownershipMarkerPath);
  if (markerStats === null || !markerStats.isFile() || markerStats.isSymbolicLink()) {
    throw new Error("Huayi application directory has no valid ownership marker.");
  }
  if ((await readFile(paths.ownershipMarkerPath, "utf8")) !== OWNERSHIP_MARKER) {
    throw new Error("Huayi application ownership marker is invalid.");
  }

  const providerDirectory = dirname(paths.schemaDirectory);
  const providerStats = await readStats(providerDirectory);
  if (providerStats !== null && (!providerStats.isDirectory() || providerStats.isSymbolicLink())) {
    throw new Error("Huayi provider path is not an owned directory.");
  }
  return true;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function validateOwnedManifest(paths: MacosInstallationPaths): Promise<boolean> {
  const manifestStats = await readStats(paths.nativeManifestPath);
  if (manifestStats === null) {
    return false;
  }
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    throw new Error("Chrome manifest path is not owned by Huayi.");
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(paths.nativeManifestPath, "utf8"));
  } catch (error) {
    throw new Error("Chrome manifest path is not owned by Huayi.", { cause: error });
  }
  if (
    !isJsonObject(manifest) ||
    manifest.name !== NATIVE_HOST_NAME ||
    manifest.path !== paths.launcherPath ||
    manifest.type !== "stdio"
  ) {
    throw new Error("Chrome manifest path is not owned by Huayi.");
  }
  return true;
}

function installActions(paths: MacosInstallationPaths): string[] {
  return [
    "Validate Node.js and Codex capabilities/login",
    `Install native host files in ${paths.applicationDirectory}`,
    `Write Chrome Native Messaging manifest ${paths.nativeManifestPath}`,
  ];
}

export async function installMacosNativeHost(
  options: InstallMacosNativeHostOptions,
): Promise<InstallerResult> {
  assertSupportedNodeVersion(options.nodeVersion);
  const paths = createMacosInstallationPaths(options.homeDirectory);
  const manifest = createNativeHostManifest(options.extensionId, paths.launcherPath);
  await validateSources(options);
  await validateOwnedApplication(paths);
  await validateOwnedManifest(paths);
  await checkCodexCapabilities({
    codexExecutable: options.codexExecutable,
    environment: options.environment,
    processRunner: options.processRunner,
    workingDirectory: tmpdir(),
  });

  const actions = installActions(paths);
  if (options.dryRun) {
    return { actions, dryRun: true, paths };
  }

  await mkdir(paths.applicationDirectory, { recursive: true });
  await writeFile(paths.ownershipMarkerPath, OWNERSHIP_MARKER, { encoding: "utf8", mode: 0o600 });
  await rm(paths.bundlePath, { force: true });
  await copyFile(options.sourceBundlePath, paths.bundlePath);
  await chmod(paths.bundlePath, 0o644);

  await rm(paths.schemaDirectory, { force: true, recursive: true });
  await mkdir(paths.schemaDirectory, { recursive: true });
  await Promise.all(
    OUTPUT_SCHEMA_NAMES.map((name) =>
      copyFile(join(options.sourceSchemaDirectory, name), join(paths.schemaDirectory, name)),
    ),
  );
  await rm(paths.workingDirectory, { force: true, recursive: true });
  await mkdir(paths.workingDirectory, { recursive: true, mode: 0o700 });

  await rm(paths.launcherPath, { force: true });
  await writeFile(
    paths.launcherPath,
    renderLauncherScript({
      bundlePath: paths.bundlePath,
      codexExecutable: options.codexExecutable,
      ...(options.environment.CODEX_HOME === undefined
        ? {}
        : { codexHome: options.environment.CODEX_HOME }),
      homeDirectory: options.homeDirectory,
      nodeExecutable: options.nodeExecutable,
      schemaDirectory: paths.schemaDirectory,
      workingDirectory: paths.workingDirectory,
    }),
    { encoding: "utf8", mode: 0o755 },
  );
  await chmod(paths.launcherPath, 0o755);

  await mkdir(dirname(paths.nativeManifestPath), { recursive: true });
  await writeFile(paths.nativeManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { actions, dryRun: false, paths };
}

export async function uninstallMacosNativeHost(
  options: UninstallMacosNativeHostOptions,
): Promise<InstallerResult> {
  const paths = createMacosInstallationPaths(options.homeDirectory);
  const hasApplication = await validateOwnedApplication(paths);
  const hasManifest = await validateOwnedManifest(paths);
  const actions = [
    ...(hasManifest ? [`Remove Chrome Native Messaging manifest ${paths.nativeManifestPath}`] : []),
    ...(hasApplication ? [`Remove Huayi native host ${paths.applicationDirectory}`] : []),
  ];
  if (options.dryRun) {
    return { actions, dryRun: true, paths };
  }

  if (hasManifest) {
    await rm(paths.nativeManifestPath, { force: true });
  }
  if (hasApplication) {
    await rm(paths.applicationDirectory, { force: true, recursive: true });
  }
  return { actions, dryRun: false, paths };
}

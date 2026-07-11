import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NodeProcessRunner, type ProcessRunner } from "../runtime/codex-process.js";
import {
  installMacosNativeHost,
  uninstallMacosNativeHost,
  type InstallMacosNativeHostOptions,
  type InstallerResult,
  type UninstallMacosNativeHostOptions,
} from "./macos.js";
import { validateExtensionId } from "./native-manifest.js";

const USAGE = [
  "Usage:",
  "  huayi-installer install --extension-id <ID> [--codex-path <PATH>] [--dry-run]",
  "  huayi-installer uninstall [--dry-run]",
].join("\n");

export type InstallerCommand =
  | { type: "help" }
  | { codexPath?: string; dryRun: boolean; extensionId: string; type: "install" }
  | { dryRun: boolean; type: "uninstall" };

export interface InstallerCliOperations {
  install(options: InstallMacosNativeHostOptions): Promise<InstallerResult>;
  uninstall(options: UninstallMacosNativeHostOptions): Promise<InstallerResult>;
}

export interface InstallerCliRuntime {
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  nodeExecutable: string;
  nodeVersion: string;
  operations: InstallerCliOperations;
  platform: NodeJS.Platform;
  processRunner: ProcessRunner;
  sourceBundlePath: string;
  sourceSchemaDirectory: string;
  writeOutput(message: string): void;
}

function argumentValue(arguments_: readonly string[], index: number, option: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires an argument.\n${USAGE}`);
  }
  return value;
}

export function parseInstallerArguments(arguments_: readonly string[]): InstallerCommand {
  if (
    arguments_.length === 1 &&
    (arguments_[0] === "--help" || arguments_[0] === "help" || arguments_[0] === "-h")
  ) {
    return { type: "help" };
  }

  const command = arguments_[0];
  if (command !== "install" && command !== "uninstall") {
    throw new Error(USAGE);
  }

  let codexPath: string | undefined;
  let dryRun = false;
  let extensionId: string | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    switch (argument) {
      case "--":
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--extension-id":
        extensionId = argumentValue(arguments_, index, argument);
        index += 1;
        break;
      case "--codex-path":
        codexPath = argumentValue(arguments_, index, argument);
        index += 1;
        break;
      default:
        throw new Error(`Unknown installer argument: ${argument ?? ""}.\n${USAGE}`);
    }
  }

  if (command === "uninstall") {
    if (extensionId !== undefined || codexPath !== undefined) {
      throw new Error(`Uninstall does not accept install-only arguments.\n${USAGE}`);
    }
    return { dryRun, type: "uninstall" };
  }
  if (extensionId === undefined) {
    throw new Error(`Install requires --extension-id.\n${USAGE}`);
  }
  validateExtensionId(extensionId);
  return {
    ...(codexPath === undefined ? {} : { codexPath }),
    dryRun,
    extensionId,
    type: "install",
  };
}

async function canonicalExecutable(path: string): Promise<string> {
  await access(path, constants.X_OK);
  return realpath(path);
}

export async function resolveCodexExecutable(
  explicitPath: string | undefined,
  pathEnvironment: string | undefined,
): Promise<string> {
  if (explicitPath !== undefined) {
    if (!isAbsolute(explicitPath)) {
      throw new TypeError("Explicit Codex path must be absolute.");
    }
    try {
      return await canonicalExecutable(explicitPath);
    } catch (error) {
      throw new Error("Codex CLI executable is not accessible.", { cause: error });
    }
  }

  for (const directory of pathEnvironment?.split(delimiter) ?? []) {
    if (!isAbsolute(directory)) {
      continue;
    }
    try {
      return await canonicalExecutable(join(directory, "codex"));
    } catch {
      // Continue through the explicit PATH allowlist without invoking a shell.
    }
  }
  throw new Error("Codex CLI executable was not found in PATH.");
}

function reportResult(result: InstallerResult, runtime: InstallerCliRuntime): void {
  if (result.actions.length === 0) {
    runtime.writeOutput("No installed Huayi files were found.");
    return;
  }
  const prefix = result.dryRun ? "[dry-run] " : "";
  for (const action of result.actions) {
    runtime.writeOutput(`${prefix}${action}`);
  }
}

export async function executeInstallerCommand(
  command: InstallerCommand,
  runtime: InstallerCliRuntime,
): Promise<void> {
  if (command.type === "help") {
    runtime.writeOutput(USAGE);
    return;
  }
  if (runtime.platform !== "darwin") {
    throw new Error("Huayi Native Host installation currently supports macOS only.");
  }

  if (command.type === "uninstall") {
    const result = await runtime.operations.uninstall({
      dryRun: command.dryRun,
      homeDirectory: runtime.homeDirectory,
    });
    reportResult(result, runtime);
    return;
  }

  const codexExecutable =
    command.codexPath ?? (await resolveCodexExecutable(undefined, runtime.environment.PATH));
  const result = await runtime.operations.install({
    codexExecutable,
    dryRun: command.dryRun,
    environment: runtime.environment,
    extensionId: command.extensionId,
    homeDirectory: runtime.homeDirectory,
    nodeExecutable: runtime.nodeExecutable,
    nodeVersion: runtime.nodeVersion,
    processRunner: runtime.processRunner,
    sourceBundlePath: runtime.sourceBundlePath,
    sourceSchemaDirectory: runtime.sourceSchemaDirectory,
  });
  reportResult(result, runtime);
}

export function createDefaultInstallerRuntime(moduleUrl = import.meta.url): InstallerCliRuntime {
  return {
    environment: process.env,
    homeDirectory: homedir(),
    nodeExecutable: process.execPath,
    nodeVersion: process.versions.node,
    operations: {
      install: installMacosNativeHost,
      uninstall: uninstallMacosNativeHost,
    },
    platform: process.platform,
    processRunner: new NodeProcessRunner(),
    sourceBundlePath: fileURLToPath(new URL("../main.js", moduleUrl)),
    sourceSchemaDirectory: fileURLToPath(new URL("../provider/schemas/", moduleUrl)),
    writeOutput: (message) => process.stdout.write(`${message}\n`),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown installer error.";
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url;
}

async function runDefaultInstaller(): Promise<void> {
  const command = parseInstallerArguments(process.argv.slice(2));
  await executeInstallerCommand(command, createDefaultInstallerRuntime());
}

if (isDirectExecution()) {
  void runDefaultInstaller().catch((error: unknown) => {
    process.stderr.write(`Huayi installer error: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}

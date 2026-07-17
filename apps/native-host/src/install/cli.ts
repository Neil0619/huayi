import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ModelProvider } from "@huayi/protocol";

import { CompatibleHttpConfigurationStore } from "../config/compatible-http-configuration-store.js";
import { parseProviderAlias } from "../config/provider-configuration.js";
import {
  executeCompatibleConfigurationCommand,
  isCompatibleConfigurationCommand,
  parseCompatibleConfigurationCommand,
  type CompatibleConfigurationInstallerCommand,
  type CompatibleConfigurationStoreAccess,
} from "./compatible-http-configuration-cli.js";
import {
  ProviderConfigurationStore,
  type ProviderConfigurationResult,
} from "../config/provider-configuration-store.js";
import { OPENAI_SECURITY_EXECUTABLE } from "../credentials/openai-keychain.js";
import { NodeProcessRunner, type ProcessRunner } from "../runtime/codex-process.js";
import {
  compatibleCredentialCliOperations,
  executeCompatibleCredentialCommand,
  isCompatibleCredentialCommand,
  parseCompatibleCredentialCommand,
  type CompatibleCredentialCliOperations,
  type CompatibleCredentialInstallerCommand,
} from "./compatible-http-credential-cli.js";
import {
  deepSeekCredentialCliOperations,
  executeDeepSeekCredentialCommand,
  isDeepSeekCredentialCommand,
  type DeepSeekCredentialCliOperations,
  type DeepSeekCredentialInstallerCommand,
} from "./deepseek-credential-cli.js";
import { resolveCodexExecutable } from "./codex-executable.js";
import {
  configureEudicAuthorization,
  NodeInteractiveProcessRunner,
  removeEudicAuthorization,
  type ConfigureEudicAuthorizationOptions,
  type CredentialOperationResult,
  type InteractiveProcessRunner,
  type RemoveEudicAuthorizationOptions,
} from "./eudic-keychain.js";
import {
  configureOpenAIApiKey,
  removeOpenAIApiKey,
  type ConfigureOpenAIApiKeyOptions,
  type RemoveOpenAIApiKeyOptions,
} from "./openai-keychain.js";
import {
  installMacosNativeHost,
  uninstallMacosNativeHost,
  type InstallMacosNativeHostOptions,
  type InstallerResult,
  type UninstallMacosNativeHostOptions,
} from "./macos.js";
import { validateExtensionId } from "./native-manifest.js";
import { createMacosInstallationPaths } from "./paths.js";

const USAGE = [
  "Usage:",
  "  huayi-installer install --extension-id <ID> [--codex-path <PATH>] [--dry-run]",
  "  huayi-installer uninstall [--dry-run]",
  "  huayi-installer eudic-configure [--dry-run]",
  "  huayi-installer eudic-remove [--dry-run]",
  "  huayi-installer openai-configure [--dry-run]",
  "  huayi-installer openai-remove [--dry-run]",
  "  huayi-installer deepseek-configure [--dry-run]",
  "  huayi-installer deepseek-remove [--dry-run]",
  "  huayi-installer compatible-key-configure [--dry-run]",
  "  huayi-installer compatible-key-remove [--dry-run]",
  "  huayi-installer compatible-config-set --base-url <URL> --model <MODEL> --effort <EFFORT> --allow-insecure-http [--dry-run]",
  "  huayi-installer compatible-config-status",
  "  huayi-installer compatible-config-remove [--dry-run]",
  "  huayi-installer provider-set <api|codex|compatible-http|deepseek> [--dry-run]",
  "  huayi-installer provider-status",
].join("\n");

export type InstallerCommand =
  | { type: "help" }
  | CompatibleConfigurationInstallerCommand
  | CompatibleCredentialInstallerCommand
  | { codexPath?: string; dryRun: boolean; extensionId: string; type: "install" }
  | { dryRun: boolean; type: "eudic-configure" }
  | { dryRun: boolean; type: "eudic-remove" }
  | { dryRun: boolean; type: "openai-configure" }
  | { dryRun: boolean; type: "openai-remove" }
  | DeepSeekCredentialInstallerCommand
  | { dryRun: boolean; provider: ModelProvider; type: "provider-set" }
  | { type: "provider-status" }
  | { dryRun: boolean; type: "uninstall" };

export interface ProviderConfigurationAccess {
  read(signal?: AbortSignal): Promise<ModelProvider>;
  write(provider: ModelProvider, dryRun: boolean): Promise<ProviderConfigurationResult>;
}

export interface InstallerCliOperations {
  configureEudic(options: ConfigureEudicAuthorizationOptions): Promise<CredentialOperationResult>;
  configureOpenAI(options: ConfigureOpenAIApiKeyOptions): Promise<CredentialOperationResult>;
  install(options: InstallMacosNativeHostOptions): Promise<InstallerResult>;
  removeEudic(options: RemoveEudicAuthorizationOptions): Promise<CredentialOperationResult>;
  removeOpenAI(options: RemoveOpenAIApiKeyOptions): Promise<CredentialOperationResult>;
  uninstall(options: UninstallMacosNativeHostOptions): Promise<InstallerResult>;
}

export interface InstallerCliRuntime {
  compatibleCredentialOperations: CompatibleCredentialCliOperations;
  compatibleHttpConfigurationStore: CompatibleConfigurationStoreAccess;
  deepSeekCredentialOperations?: DeepSeekCredentialCliOperations;
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  interactiveProcessRunner: InteractiveProcessRunner;
  nodeExecutable: string;
  nodeVersion: string;
  operations: InstallerCliOperations;
  platform: NodeJS.Platform;
  processRunner: ProcessRunner;
  providerConfigurationStore: ProviderConfigurationAccess;
  securityExecutable: string;
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
  const compatibleCredentialCommand = parseCompatibleCredentialCommand(arguments_);
  if (compatibleCredentialCommand !== undefined) return compatibleCredentialCommand;
  const compatibleConfigurationCommand = parseCompatibleConfigurationCommand(arguments_);
  if (compatibleConfigurationCommand !== undefined) return compatibleConfigurationCommand;
  const command = arguments_[0];
  if (command === "provider-status") {
    if (arguments_.length !== 1) {
      throw new Error(`provider-status does not accept arguments.\n${USAGE}`);
    }
    return { type: "provider-status" };
  }
  if (command === "provider-set") {
    const providerAlias = arguments_[1];
    if (providerAlias === undefined) {
      throw new Error(`provider-set requires api, codex, compatible-http, or deepseek.\n${USAGE}`);
    }
    const provider = parseProviderAlias(providerAlias);
    if (arguments_.length > 3 || (arguments_.length === 3 && arguments_[2] !== "--dry-run")) {
      throw new Error(`provider-set accepts only a provider followed by --dry-run.\n${USAGE}`);
    }
    return {
      dryRun: arguments_[2] === "--dry-run",
      provider,
      type: "provider-set",
    };
  }
  if (
    command !== "install" &&
    command !== "uninstall" &&
    command !== "eudic-configure" &&
    command !== "eudic-remove" &&
    command !== "openai-configure" &&
    command !== "openai-remove" &&
    command !== "deepseek-configure" &&
    command !== "deepseek-remove"
  ) {
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

  if (command !== "install") {
    if (extensionId !== undefined || codexPath !== undefined) {
      throw new Error(`${command} does not accept install-only arguments.\n${USAGE}`);
    }
    return { dryRun, type: command };
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

export { resolveCodexExecutable } from "./codex-executable.js";

function reportResult(result: CredentialOperationResult, runtime: InstallerCliRuntime): void {
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
  if (isCompatibleCredentialCommand(command)) {
    reportResult(await executeCompatibleCredentialCommand(command, runtime), runtime);
    return;
  }
  if (isCompatibleConfigurationCommand(command)) {
    await executeCompatibleConfigurationCommand(command, runtime);
    return;
  }
  if (command.type === "provider-status") {
    runtime.writeOutput(await runtime.providerConfigurationStore.read());
    return;
  }
  if (command.type === "provider-set") {
    if (command.provider === "openai-compatible-http") {
      await runtime.compatibleHttpConfigurationStore.read(new AbortController().signal);
    }
    const result = await runtime.providerConfigurationStore.write(command.provider, command.dryRun);
    runtime.writeOutput(`${result.dryRun ? "[dry-run] " : ""}Set provider to ${result.provider}.`);
    return;
  }

  if (isDeepSeekCredentialCommand(command)) {
    reportResult(await executeDeepSeekCredentialCommand(command, runtime), runtime);
    return;
  }

  const keychainOptions = {
    dryRun: command.dryRun,
    environment: runtime.environment,
    homeDirectory: runtime.homeDirectory,
    securityExecutable: runtime.securityExecutable,
  };
  if (command.type === "eudic-configure") {
    const result = await runtime.operations.configureEudic({
      ...keychainOptions,
      interactiveProcessRunner: runtime.interactiveProcessRunner,
    });
    reportResult(result, runtime);
    return;
  }
  if (command.type === "eudic-remove") {
    const result = await runtime.operations.removeEudic({
      ...keychainOptions,
      processRunner: runtime.processRunner,
    });
    reportResult(result, runtime);
    return;
  }
  if (command.type === "openai-configure") {
    const result = await runtime.operations.configureOpenAI({
      ...keychainOptions,
      interactiveProcessRunner: runtime.interactiveProcessRunner,
    });
    reportResult(result, runtime);
    return;
  }
  if (command.type === "openai-remove") {
    const result = await runtime.operations.removeOpenAI({
      ...keychainOptions,
      processRunner: runtime.processRunner,
    });
    reportResult(result, runtime);
    return;
  }
  if (command.type === "uninstall") {
    const eudicCredentials = await runtime.operations.removeEudic({
      ...keychainOptions,
      processRunner: runtime.processRunner,
    });
    const openAICredentials = await runtime.operations.removeOpenAI({
      ...keychainOptions,
      processRunner: runtime.processRunner,
    });
    const deepSeekCredentials =
      runtime.deepSeekCredentialOperations === undefined
        ? { actions: [], dryRun: command.dryRun }
        : await runtime.deepSeekCredentialOperations.removeDeepSeek({
            ...keychainOptions,
            processRunner: runtime.processRunner,
          });
    const files = await runtime.operations.uninstall({
      dryRun: command.dryRun,
      homeDirectory: runtime.homeDirectory,
    });
    reportResult(
      {
        actions: [
          ...eudicCredentials.actions,
          ...openAICredentials.actions,
          ...deepSeekCredentials.actions,
          ...files.actions,
        ],
        dryRun: command.dryRun,
      },
      runtime,
    );
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
    securityExecutable: runtime.securityExecutable,
    sourceBundlePath: runtime.sourceBundlePath,
    sourceSchemaDirectory: runtime.sourceSchemaDirectory,
  });
  reportResult(result, runtime);
}

export function createDefaultInstallerRuntime(moduleUrl = import.meta.url): InstallerCliRuntime {
  const homeDirectory = homedir();
  return {
    compatibleCredentialOperations: compatibleCredentialCliOperations,
    compatibleHttpConfigurationStore: new CompatibleHttpConfigurationStore(
      createMacosInstallationPaths(homeDirectory).compatibleHttpConfigurationPath,
    ),
    deepSeekCredentialOperations: deepSeekCredentialCliOperations,
    environment: process.env,
    homeDirectory,
    interactiveProcessRunner: new NodeInteractiveProcessRunner(),
    nodeExecutable: process.execPath,
    nodeVersion: process.versions.node,
    operations: {
      configureEudic: configureEudicAuthorization,
      configureOpenAI: configureOpenAIApiKey,
      install: installMacosNativeHost,
      removeEudic: removeEudicAuthorization,
      removeOpenAI: removeOpenAIApiKey,
      uninstall: uninstallMacosNativeHost,
    },
    platform: process.platform,
    processRunner: new NodeProcessRunner(),
    providerConfigurationStore: new ProviderConfigurationStore(
      createMacosInstallationPaths(homeDirectory).providerConfigurationPath,
    ),
    securityExecutable: OPENAI_SECURITY_EXECUTABLE,
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

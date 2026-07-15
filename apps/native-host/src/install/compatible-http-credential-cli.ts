import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  configureCompatibleHttpApiKey,
  removeCompatibleHttpApiKey,
  type ConfigureCompatibleHttpApiKeyOptions,
  type RemoveCompatibleHttpApiKeyOptions,
} from "./compatible-http-keychain.js";
import type { CredentialOperationResult, InteractiveProcessRunner } from "./eudic-keychain.js";

export type CompatibleCredentialInstallerCommand =
  | { dryRun: boolean; type: "compatible-key-configure" }
  | { dryRun: boolean; type: "compatible-key-remove" };

export interface CompatibleCredentialCliOperations {
  configureCompatible(
    options: ConfigureCompatibleHttpApiKeyOptions,
  ): Promise<CredentialOperationResult>;
  removeCompatible(options: RemoveCompatibleHttpApiKeyOptions): Promise<CredentialOperationResult>;
}

interface CompatibleCredentialCliRuntime {
  compatibleCredentialOperations: CompatibleCredentialCliOperations;
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  interactiveProcessRunner: InteractiveProcessRunner;
  processRunner: ProcessRunner;
  securityExecutable: string;
}

export const compatibleCredentialCliOperations: CompatibleCredentialCliOperations = {
  configureCompatible: configureCompatibleHttpApiKey,
  removeCompatible: removeCompatibleHttpApiKey,
};

export function isCompatibleCredentialCommand(command: {
  type: string;
}): command is CompatibleCredentialInstallerCommand {
  return command.type === "compatible-key-configure" || command.type === "compatible-key-remove";
}

export function parseCompatibleCredentialCommand(
  arguments_: readonly string[],
): CompatibleCredentialInstallerCommand | undefined {
  const type = arguments_[0];
  if (type !== "compatible-key-configure" && type !== "compatible-key-remove") {
    return undefined;
  }
  if (arguments_.length === 1) {
    return { dryRun: false, type };
  }
  if (arguments_.length === 2 && arguments_[1] === "--dry-run") {
    return { dryRun: true, type };
  }
  throw new Error("Invalid compatible credential arguments; only optional --dry-run is accepted.");
}

export async function executeCompatibleCredentialCommand(
  command: CompatibleCredentialInstallerCommand,
  runtime: CompatibleCredentialCliRuntime,
): Promise<CredentialOperationResult> {
  const keychainOptions = {
    dryRun: command.dryRun,
    environment: runtime.environment,
    homeDirectory: runtime.homeDirectory,
    securityExecutable: runtime.securityExecutable,
  };
  if (command.type === "compatible-key-configure") {
    return runtime.compatibleCredentialOperations.configureCompatible({
      ...keychainOptions,
      interactiveProcessRunner: runtime.interactiveProcessRunner,
    });
  }
  return runtime.compatibleCredentialOperations.removeCompatible({
    ...keychainOptions,
    processRunner: runtime.processRunner,
  });
}

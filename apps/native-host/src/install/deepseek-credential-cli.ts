import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  deepSeekCredentialCliOperations,
  type DeepSeekCredentialCliOperations,
} from "./deepseek-keychain.js";
import type { CredentialOperationResult, InteractiveProcessRunner } from "./eudic-keychain.js";

export type DeepSeekCredentialInstallerCommand =
  { dryRun: boolean; type: "deepseek-configure" } | { dryRun: boolean; type: "deepseek-remove" };

interface DeepSeekCredentialCliRuntime {
  deepSeekCredentialOperations?: DeepSeekCredentialCliOperations;
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  interactiveProcessRunner: InteractiveProcessRunner;
  processRunner: ProcessRunner;
  securityExecutable: string;
}

export { deepSeekCredentialCliOperations };
export type { DeepSeekCredentialCliOperations };

export function isDeepSeekCredentialCommand(command: {
  type: string;
}): command is DeepSeekCredentialInstallerCommand {
  return command.type === "deepseek-configure" || command.type === "deepseek-remove";
}

export async function executeDeepSeekCredentialCommand(
  command: DeepSeekCredentialInstallerCommand,
  runtime: DeepSeekCredentialCliRuntime,
): Promise<CredentialOperationResult> {
  const operations = runtime.deepSeekCredentialOperations;
  if (operations === undefined) throw new Error("DeepSeek credential operations are unavailable.");
  const keychainOptions = {
    dryRun: command.dryRun,
    environment: runtime.environment,
    homeDirectory: runtime.homeDirectory,
    securityExecutable: runtime.securityExecutable,
  };
  if (command.type === "deepseek-configure") {
    return operations.configureDeepSeek({
      ...keychainOptions,
      interactiveProcessRunner: runtime.interactiveProcessRunner,
    });
  }
  return operations.removeDeepSeek({
    ...keychainOptions,
    processRunner: runtime.processRunner,
  });
}

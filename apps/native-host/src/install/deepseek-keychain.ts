import { constants } from "node:fs";
import { access } from "node:fs/promises";

import {
  DEEPSEEK_KEYCHAIN_ACCOUNT,
  DEEPSEEK_KEYCHAIN_LABEL,
  DEEPSEEK_KEYCHAIN_SERVICE,
  DEEPSEEK_KEYCHAIN_TIMEOUT_MS,
  MAXIMUM_DEEPSEEK_API_KEY_BYTES,
} from "../credentials/deepseek-keychain.js";
import type { ProcessRunner, ProcessRunResult } from "../runtime/codex-process.js";
import type {
  CredentialOperationResult,
  InteractiveProcessResult,
  InteractiveProcessRunner,
} from "./eudic-keychain.js";

const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;
const CONFIGURE_ACTION = `Configure macOS Keychain item ${DEEPSEEK_KEYCHAIN_SERVICE}/${DEEPSEEK_KEYCHAIN_ACCOUNT}`;
const REMOVE_ACTION = `Remove macOS Keychain item ${DEEPSEEK_KEYCHAIN_SERVICE}/${DEEPSEEK_KEYCHAIN_ACCOUNT}`;

export interface ConfigureDeepSeekApiKeyOptions {
  readonly dryRun: boolean;
  readonly environment: NodeJS.ProcessEnv;
  readonly homeDirectory: string;
  readonly interactiveProcessRunner: InteractiveProcessRunner;
  readonly securityExecutable: string;
}

export interface RemoveDeepSeekApiKeyOptions {
  readonly dryRun: boolean;
  readonly environment: NodeJS.ProcessEnv;
  readonly homeDirectory: string;
  readonly processRunner: ProcessRunner;
  readonly securityExecutable: string;
}

export interface DeepSeekCredentialCliOperations {
  configureDeepSeek(options: ConfigureDeepSeekApiKeyOptions): Promise<CredentialOperationResult>;
  removeDeepSeek(options: RemoveDeepSeekApiKeyOptions): Promise<CredentialOperationResult>;
}

async function validateSecurityExecutable(path: string): Promise<void> {
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new Error("macOS Keychain security command is not accessible.");
  }
}

export async function configureDeepSeekApiKey(
  options: ConfigureDeepSeekApiKeyOptions,
): Promise<CredentialOperationResult> {
  await validateSecurityExecutable(options.securityExecutable);
  if (options.dryRun) return { actions: [CONFIGURE_ACTION], dryRun: true };
  let result: InteractiveProcessResult;
  try {
    result = await options.interactiveProcessRunner.run({
      arguments: [
        "add-generic-password",
        "-U",
        "-s",
        DEEPSEEK_KEYCHAIN_SERVICE,
        "-a",
        DEEPSEEK_KEYCHAIN_ACCOUNT,
        "-l",
        DEEPSEEK_KEYCHAIN_LABEL,
        "-w",
      ],
      cwd: options.homeDirectory,
      env: options.environment,
      executable: options.securityExecutable,
      shell: false,
    });
  } catch {
    throw new Error("Unable to configure the Huayi DeepSeek Keychain item.");
  }
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new Error("Unable to configure the Huayi DeepSeek Keychain item.");
  }
  return { actions: [CONFIGURE_ACTION], dryRun: false };
}

function runSecurity(
  options: RemoveDeepSeekApiKeyOptions,
  arguments_: readonly string[],
): Promise<ProcessRunResult> {
  return options.processRunner.run({
    arguments: arguments_,
    cwd: options.homeDirectory,
    env: options.environment,
    executable: options.securityExecutable,
    input: "",
    maximumOutputBytes: MAXIMUM_DEEPSEEK_API_KEY_BYTES,
    timeoutMs: DEEPSEEK_KEYCHAIN_TIMEOUT_MS,
  });
}

export async function removeDeepSeekApiKey(
  options: RemoveDeepSeekApiKeyOptions,
): Promise<CredentialOperationResult> {
  await validateSecurityExecutable(options.securityExecutable);
  let query: ProcessRunResult;
  try {
    query = await runSecurity(options, [
      "find-generic-password",
      "-s",
      DEEPSEEK_KEYCHAIN_SERVICE,
      "-a",
      DEEPSEEK_KEYCHAIN_ACCOUNT,
    ]);
  } catch {
    throw new Error("Unable to inspect the Huayi DeepSeek Keychain item.");
  }
  if (query.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
    return { actions: [], dryRun: options.dryRun };
  }
  if (query.exitCode !== 0 || query.signal !== null) {
    throw new Error("Unable to inspect the Huayi DeepSeek Keychain item.");
  }
  if (options.dryRun) return { actions: [REMOVE_ACTION], dryRun: true };
  let deletion: ProcessRunResult;
  try {
    deletion = await runSecurity(options, [
      "delete-generic-password",
      "-s",
      DEEPSEEK_KEYCHAIN_SERVICE,
      "-a",
      DEEPSEEK_KEYCHAIN_ACCOUNT,
    ]);
  } catch {
    throw new Error("Unable to remove the Huayi DeepSeek Keychain item.");
  }
  if (deletion.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
    return { actions: [], dryRun: false };
  }
  if (deletion.exitCode !== 0 || deletion.signal !== null) {
    throw new Error("Unable to remove the Huayi DeepSeek Keychain item.");
  }
  return { actions: [REMOVE_ACTION], dryRun: false };
}

export const deepSeekCredentialCliOperations: DeepSeekCredentialCliOperations = {
  configureDeepSeek: configureDeepSeekApiKey,
  removeDeepSeek: removeDeepSeekApiKey,
};

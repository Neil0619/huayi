import { constants } from "node:fs";
import { access } from "node:fs/promises";

import {
  COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT,
  COMPATIBLE_HTTP_KEYCHAIN_LABEL,
  COMPATIBLE_HTTP_KEYCHAIN_SERVICE,
  COMPATIBLE_HTTP_KEYCHAIN_TIMEOUT_MS,
  COMPATIBLE_HTTP_SECURITY_EXECUTABLE,
  MAXIMUM_COMPATIBLE_HTTP_API_KEY_BYTES,
} from "../credentials/compatible-http-keychain.js";
import type { ProcessRunner, ProcessRunResult } from "../runtime/codex-process.js";
import type {
  CredentialOperationResult,
  InteractiveProcessResult,
  InteractiveProcessRunner,
} from "./eudic-keychain.js";

export type { InteractiveProcessRequest, InteractiveProcessRunner } from "./eudic-keychain.js";

const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;
const CONFIGURE_ACTION = `Configure macOS Keychain item ${COMPATIBLE_HTTP_KEYCHAIN_SERVICE}/${COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT}`;
const REMOVE_ACTION = `Remove macOS Keychain item ${COMPATIBLE_HTTP_KEYCHAIN_SERVICE}/${COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT}`;

export interface ConfigureCompatibleHttpApiKeyOptions {
  dryRun: boolean;
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  interactiveProcessRunner: InteractiveProcessRunner;
}

export interface RemoveCompatibleHttpApiKeyOptions {
  dryRun: boolean;
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  processRunner: ProcessRunner;
}

async function validateSecurityExecutable(): Promise<void> {
  try {
    await access(COMPATIBLE_HTTP_SECURITY_EXECUTABLE, constants.X_OK);
  } catch (error) {
    throw new Error("macOS Keychain security command is not accessible.", { cause: error });
  }
}

export async function configureCompatibleHttpApiKey(
  options: ConfigureCompatibleHttpApiKeyOptions,
): Promise<CredentialOperationResult> {
  await validateSecurityExecutable();
  if (options.dryRun) {
    return { actions: [CONFIGURE_ACTION], dryRun: true };
  }

  let result: InteractiveProcessResult;
  try {
    result = await options.interactiveProcessRunner.run({
      arguments: [
        "add-generic-password",
        "-U",
        "-s",
        COMPATIBLE_HTTP_KEYCHAIN_SERVICE,
        "-a",
        COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT,
        "-l",
        COMPATIBLE_HTTP_KEYCHAIN_LABEL,
        "-w",
      ],
      cwd: options.homeDirectory,
      env: options.environment,
      executable: COMPATIBLE_HTTP_SECURITY_EXECUTABLE,
      shell: false,
    });
  } catch {
    throw new Error("Unable to configure the Huayi compatible HTTP Keychain item.");
  }
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new Error("Unable to configure the Huayi compatible HTTP Keychain item.");
  }
  return { actions: [CONFIGURE_ACTION], dryRun: false };
}

async function runCapturedSecurityCommand(
  options: RemoveCompatibleHttpApiKeyOptions,
  arguments_: readonly string[],
) {
  return options.processRunner.run({
    arguments: arguments_,
    cwd: options.homeDirectory,
    env: options.environment,
    executable: COMPATIBLE_HTTP_SECURITY_EXECUTABLE,
    input: "",
    maximumOutputBytes: MAXIMUM_COMPATIBLE_HTTP_API_KEY_BYTES,
    timeoutMs: COMPATIBLE_HTTP_KEYCHAIN_TIMEOUT_MS,
  });
}

export async function removeCompatibleHttpApiKey(
  options: RemoveCompatibleHttpApiKeyOptions,
): Promise<CredentialOperationResult> {
  await validateSecurityExecutable();
  let query: ProcessRunResult;
  try {
    query = await runCapturedSecurityCommand(options, [
      "find-generic-password",
      "-s",
      COMPATIBLE_HTTP_KEYCHAIN_SERVICE,
      "-a",
      COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT,
    ]);
  } catch {
    throw new Error("Unable to inspect the Huayi compatible HTTP Keychain item.");
  }
  if (query.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
    return { actions: [], dryRun: options.dryRun };
  }
  if (query.exitCode !== 0 || query.signal !== null) {
    throw new Error("Unable to inspect the Huayi compatible HTTP Keychain item.");
  }
  if (options.dryRun) {
    return { actions: [REMOVE_ACTION], dryRun: true };
  }

  let deletion: ProcessRunResult;
  try {
    deletion = await runCapturedSecurityCommand(options, [
      "delete-generic-password",
      "-s",
      COMPATIBLE_HTTP_KEYCHAIN_SERVICE,
      "-a",
      COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT,
    ]);
  } catch {
    throw new Error("Unable to remove the Huayi compatible HTTP Keychain item.");
  }
  if (deletion.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
    return { actions: [], dryRun: false };
  }
  if (deletion.exitCode !== 0 || deletion.signal !== null) {
    throw new Error("Unable to remove the Huayi compatible HTTP Keychain item.");
  }
  return { actions: [REMOVE_ACTION], dryRun: false };
}

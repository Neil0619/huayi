import { constants } from "node:fs";
import { access } from "node:fs/promises";

import {
  MAXIMUM_OPENAI_API_KEY_BYTES,
  OPENAI_KEYCHAIN_ACCOUNT,
  OPENAI_KEYCHAIN_LABEL,
  OPENAI_KEYCHAIN_SERVICE,
  OPENAI_KEYCHAIN_TIMEOUT_MS,
} from "../credentials/openai-keychain.js";
import type { ProcessRunner, ProcessRunResult } from "../runtime/codex-process.js";
import type {
  CredentialOperationResult,
  InteractiveProcessResult,
  InteractiveProcessRunner,
} from "./eudic-keychain.js";

export type { InteractiveProcessRequest, InteractiveProcessRunner } from "./eudic-keychain.js";

const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;
const CONFIGURE_ACTION = `Configure macOS Keychain item ${OPENAI_KEYCHAIN_SERVICE}/${OPENAI_KEYCHAIN_ACCOUNT}`;
const REMOVE_ACTION = `Remove macOS Keychain item ${OPENAI_KEYCHAIN_SERVICE}/${OPENAI_KEYCHAIN_ACCOUNT}`;

export interface ConfigureOpenAIApiKeyOptions {
  dryRun: boolean;
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  interactiveProcessRunner: InteractiveProcessRunner;
  securityExecutable: string;
}

export interface RemoveOpenAIApiKeyOptions {
  dryRun: boolean;
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  processRunner: ProcessRunner;
  securityExecutable: string;
}

async function validateSecurityExecutable(path: string): Promise<void> {
  try {
    await access(path, constants.X_OK);
  } catch (error) {
    throw new Error("macOS Keychain security command is not accessible.", { cause: error });
  }
}

export async function configureOpenAIApiKey(
  options: ConfigureOpenAIApiKeyOptions,
): Promise<CredentialOperationResult> {
  await validateSecurityExecutable(options.securityExecutable);
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
        OPENAI_KEYCHAIN_SERVICE,
        "-a",
        OPENAI_KEYCHAIN_ACCOUNT,
        "-l",
        OPENAI_KEYCHAIN_LABEL,
        "-w",
      ],
      cwd: options.homeDirectory,
      env: options.environment,
      executable: options.securityExecutable,
      shell: false,
    });
  } catch {
    throw new Error("Unable to configure the Huayi OpenAI Keychain item.");
  }
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new Error("Unable to configure the Huayi OpenAI Keychain item.");
  }
  return { actions: [CONFIGURE_ACTION], dryRun: false };
}

async function runCapturedSecurityCommand(
  options: RemoveOpenAIApiKeyOptions,
  arguments_: readonly string[],
) {
  return options.processRunner.run({
    arguments: arguments_,
    cwd: options.homeDirectory,
    env: options.environment,
    executable: options.securityExecutable,
    input: "",
    maximumOutputBytes: MAXIMUM_OPENAI_API_KEY_BYTES,
    timeoutMs: OPENAI_KEYCHAIN_TIMEOUT_MS,
  });
}

export async function removeOpenAIApiKey(
  options: RemoveOpenAIApiKeyOptions,
): Promise<CredentialOperationResult> {
  await validateSecurityExecutable(options.securityExecutable);
  let query: ProcessRunResult;
  try {
    query = await runCapturedSecurityCommand(options, [
      "find-generic-password",
      "-s",
      OPENAI_KEYCHAIN_SERVICE,
      "-a",
      OPENAI_KEYCHAIN_ACCOUNT,
    ]);
  } catch {
    throw new Error("Unable to inspect the Huayi OpenAI Keychain item.");
  }
  if (query.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
    return { actions: [], dryRun: options.dryRun };
  }
  if (query.exitCode !== 0 || query.signal !== null) {
    throw new Error("Unable to inspect the Huayi OpenAI Keychain item.");
  }
  if (options.dryRun) {
    return { actions: [REMOVE_ACTION], dryRun: true };
  }

  let deletion: ProcessRunResult;
  try {
    deletion = await runCapturedSecurityCommand(options, [
      "delete-generic-password",
      "-s",
      OPENAI_KEYCHAIN_SERVICE,
      "-a",
      OPENAI_KEYCHAIN_ACCOUNT,
    ]);
  } catch {
    throw new Error("Unable to remove the Huayi OpenAI Keychain item.");
  }
  if (deletion.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
    return { actions: [], dryRun: false };
  }
  if (deletion.exitCode !== 0 || deletion.signal !== null) {
    throw new Error("Unable to remove the Huayi OpenAI Keychain item.");
  }
  return { actions: [REMOVE_ACTION], dryRun: false };
}

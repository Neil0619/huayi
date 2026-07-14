import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";

import {
  EUDIC_KEYCHAIN_ACCOUNT,
  EUDIC_KEYCHAIN_LABEL,
  EUDIC_KEYCHAIN_SERVICE,
  EUDIC_KEYCHAIN_TIMEOUT_MS,
  MAXIMUM_EUDIC_AUTHORIZATION_BYTES,
} from "../credentials/eudic-keychain.js";
import { buildAllowedEnvironment, type ProcessRunner } from "../runtime/codex-process.js";

const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;

export interface CredentialOperationResult {
  actions: readonly string[];
  dryRun: boolean;
}

export interface InteractiveProcessRequest {
  arguments: readonly string[];
  cwd: string;
  env: Readonly<NodeJS.ProcessEnv>;
  executable: string;
  shell: false;
}

export interface InteractiveProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface InteractiveProcessRunner {
  run(request: InteractiveProcessRequest): Promise<InteractiveProcessResult>;
}

export interface ConfigureEudicAuthorizationOptions {
  dryRun: boolean;
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  interactiveProcessRunner: InteractiveProcessRunner;
  securityExecutable: string;
}

export interface RemoveEudicAuthorizationOptions {
  dryRun: boolean;
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  processRunner: ProcessRunner;
  securityExecutable: string;
}

const CONFIGURE_ACTION = `Configure macOS Keychain item ${EUDIC_KEYCHAIN_SERVICE}/${EUDIC_KEYCHAIN_ACCOUNT}`;
const REMOVE_ACTION = `Remove macOS Keychain item ${EUDIC_KEYCHAIN_SERVICE}/${EUDIC_KEYCHAIN_ACCOUNT}`;

async function validateSecurityExecutable(path: string): Promise<void> {
  try {
    await access(path, constants.X_OK);
  } catch (error) {
    throw new Error("macOS Keychain security command is not accessible.", { cause: error });
  }
}

export class NodeInteractiveProcessRunner implements InteractiveProcessRunner {
  async run(request: InteractiveProcessRequest): Promise<InteractiveProcessResult> {
    return await new Promise<InteractiveProcessResult>((resolve, reject) => {
      const child = spawn(request.executable, [...request.arguments], {
        cwd: request.cwd,
        env: buildAllowedEnvironment(request.env),
        shell: false,
        stdio: "inherit",
      });
      child.once("error", () => reject(new Error("Unable to start macOS Keychain command.")));
      child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
  }
}

export async function configureEudicAuthorization(
  options: ConfigureEudicAuthorizationOptions,
): Promise<CredentialOperationResult> {
  await validateSecurityExecutable(options.securityExecutable);
  if (options.dryRun) {
    return { actions: [CONFIGURE_ACTION], dryRun: true };
  }

  const result = await options.interactiveProcessRunner.run({
    arguments: [
      "add-generic-password",
      "-U",
      "-s",
      EUDIC_KEYCHAIN_SERVICE,
      "-a",
      EUDIC_KEYCHAIN_ACCOUNT,
      "-l",
      EUDIC_KEYCHAIN_LABEL,
      "-w",
    ],
    cwd: options.homeDirectory,
    env: options.environment,
    executable: options.securityExecutable,
    shell: false,
  });
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new Error("Unable to configure the Huayi Eudic Keychain item.");
  }
  return { actions: [CONFIGURE_ACTION], dryRun: false };
}

async function runCapturedSecurityCommand(
  options: RemoveEudicAuthorizationOptions,
  arguments_: readonly string[],
) {
  return options.processRunner.run({
    arguments: arguments_,
    cwd: options.homeDirectory,
    env: options.environment,
    executable: options.securityExecutable,
    input: "",
    maximumOutputBytes: MAXIMUM_EUDIC_AUTHORIZATION_BYTES,
    timeoutMs: EUDIC_KEYCHAIN_TIMEOUT_MS,
  });
}

export async function removeEudicAuthorization(
  options: RemoveEudicAuthorizationOptions,
): Promise<CredentialOperationResult> {
  await validateSecurityExecutable(options.securityExecutable);
  const query = await runCapturedSecurityCommand(options, [
    "find-generic-password",
    "-s",
    EUDIC_KEYCHAIN_SERVICE,
    "-a",
    EUDIC_KEYCHAIN_ACCOUNT,
  ]);
  if (query.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
    return { actions: [], dryRun: options.dryRun };
  }
  if (query.exitCode !== 0 || query.signal !== null) {
    throw new Error("Unable to inspect the Huayi Eudic Keychain item.");
  }
  if (options.dryRun) {
    return { actions: [REMOVE_ACTION], dryRun: true };
  }

  const deletion = await runCapturedSecurityCommand(options, [
    "delete-generic-password",
    "-s",
    EUDIC_KEYCHAIN_SERVICE,
    "-a",
    EUDIC_KEYCHAIN_ACCOUNT,
  ]);
  if (deletion.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
    return { actions: [], dryRun: false };
  }
  if (deletion.exitCode !== 0 || deletion.signal !== null) {
    throw new Error("Unable to remove the Huayi Eudic Keychain item.");
  }
  return { actions: [REMOVE_ACTION], dryRun: false };
}

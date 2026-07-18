import { constants } from "node:fs";
import { access } from "node:fs/promises";

import type { ProcessRunner } from "../runtime/codex-process.js";
import type { CredentialOperationResult, InteractiveProcessRunner } from "./eudic-keychain.js";

const CONFIGURE_ACTION = "Configure Windows DPAPI-protected DeepSeek credential";
const REMOVE_ACTION = "Remove Windows DPAPI-protected DeepSeek credential";

interface BaseOptions {
  readonly credentialHelperPath: string;
  readonly credentialPath: string;
  readonly dryRun: boolean;
  readonly environment: NodeJS.ProcessEnv;
  readonly powershellExecutable: string;
  readonly workingDirectory: string;
}

export interface ConfigureWindowsDeepSeekOptions extends BaseOptions {
  readonly interactiveProcessRunner: InteractiveProcessRunner;
}

export interface RemoveWindowsDeepSeekOptions extends BaseOptions {
  readonly processRunner: ProcessRunner;
}

async function validateHelpers(options: BaseOptions): Promise<void> {
  try {
    await Promise.all([
      access(options.powershellExecutable, constants.X_OK),
      access(options.credentialHelperPath, constants.R_OK),
    ]);
  } catch {
    throw new Error("Windows PowerShell or the Huayi credential helper is unavailable.");
  }
}

function argumentsFor(operation: "configure" | "remove", options: BaseOptions): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    options.credentialHelperPath,
    operation,
    options.credentialPath,
  ];
}

export async function configureWindowsDeepSeekCredential(
  options: ConfigureWindowsDeepSeekOptions,
): Promise<CredentialOperationResult> {
  await validateHelpers(options);
  if (options.dryRun) return { actions: [CONFIGURE_ACTION], dryRun: true };
  const result = await options.interactiveProcessRunner.run({
    arguments: argumentsFor("configure", options),
    cwd: options.workingDirectory,
    env: options.environment,
    executable: options.powershellExecutable,
    shell: false,
  });
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new Error("Unable to configure the Windows DeepSeek credential.");
  }
  return { actions: [CONFIGURE_ACTION], dryRun: false };
}

export async function removeWindowsDeepSeekCredential(
  options: RemoveWindowsDeepSeekOptions,
): Promise<CredentialOperationResult> {
  await validateHelpers(options);
  if (options.dryRun) return { actions: [REMOVE_ACTION], dryRun: true };
  const result = await options.processRunner.run({
    arguments: argumentsFor("remove", options),
    cwd: options.workingDirectory,
    env: options.environment,
    executable: options.powershellExecutable,
    input: "",
    maximumOutputBytes: 8 * 1024,
    timeoutMs: 5_000,
  });
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new Error("Unable to remove the Windows DeepSeek credential.");
  }
  return { actions: [REMOVE_ACTION], dryRun: false };
}

import {
  compatibleHttpConfigurationSchema,
  type CompatibleHttpConfiguration,
} from "../config/compatible-http-configuration.js";
import type { CompatibleConfigurationOperationResult } from "../config/compatible-http-configuration-store.js";

export type CompatibleConfigurationInstallerCommand =
  | {
      readonly configuration: CompatibleHttpConfiguration;
      readonly dryRun: boolean;
      readonly type: "compatible-config-set";
    }
  | { readonly dryRun: boolean; readonly type: "compatible-config-remove" }
  | { readonly type: "compatible-config-status" };

export interface CompatibleConfigurationStoreAccess {
  read(signal: AbortSignal): Promise<CompatibleHttpConfiguration>;
  remove(dryRun: boolean): Promise<CompatibleConfigurationOperationResult>;
  write(
    configuration: CompatibleHttpConfiguration,
    dryRun: boolean,
  ): Promise<CompatibleConfigurationOperationResult>;
}

export interface CompatibleConfigurationCliRuntime {
  readonly compatibleHttpConfigurationStore: CompatibleConfigurationStoreAccess;
  writeOutput(message: string): void;
}

function valueAfter(arguments_: readonly string[], index: number, flag: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires exactly one value.`);
  }
  return value;
}

function parseSet(arguments_: readonly string[]): CompatibleConfigurationInstallerCommand {
  const seen = new Set<string>();
  let allowInsecureHttp = false;
  let baseUrl: string | undefined;
  let dryRun = false;
  let effort: string | undefined;
  let model: string | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    if (flag === undefined || flag === "--" || seen.has(flag)) {
      throw new Error("Invalid compatible HTTP configuration arguments.");
    }
    seen.add(flag);
    switch (flag) {
      case "--allow-insecure-http":
        allowInsecureHttp = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--base-url":
        baseUrl = valueAfter(arguments_, index, flag);
        index += 1;
        break;
      case "--effort":
        effort = valueAfter(arguments_, index, flag);
        index += 1;
        break;
      case "--model":
        model = valueAfter(arguments_, index, flag);
        index += 1;
        break;
      default:
        throw new Error("Invalid compatible HTTP configuration arguments.");
    }
  }
  const parsed = compatibleHttpConfigurationSchema.safeParse({
    allowInsecureHttp,
    baseUrl,
    effort,
    model,
    schemaVersion: 1,
  });
  if (!parsed.success) throw new Error("Invalid compatible HTTP configuration arguments.");
  return { configuration: parsed.data, dryRun, type: "compatible-config-set" };
}

export function parseCompatibleConfigurationCommand(
  arguments_: readonly string[],
): CompatibleConfigurationInstallerCommand | undefined {
  const command = arguments_[0];
  if (command === "compatible-config-set") return parseSet(arguments_);
  if (command === "compatible-config-status") {
    if (arguments_.length !== 1) throw new Error("compatible-config-status accepts no arguments.");
    return { type: "compatible-config-status" };
  }
  if (command === "compatible-config-remove") {
    if (arguments_.length === 1) return { dryRun: false, type: "compatible-config-remove" };
    if (arguments_.length === 2 && arguments_[1] === "--dry-run") {
      return { dryRun: true, type: "compatible-config-remove" };
    }
    throw new Error("compatible-config-remove accepts only optional --dry-run.");
  }
  return undefined;
}

function reportOperation(
  result: CompatibleConfigurationOperationResult,
  runtime: CompatibleConfigurationCliRuntime,
): void {
  if (result.actions.length === 0) {
    runtime.writeOutput("No compatible HTTP configuration was found.");
    return;
  }
  const prefix = result.dryRun ? "[dry-run] " : "";
  for (const action of result.actions) runtime.writeOutput(`${prefix}${action}`);
}

export async function executeCompatibleConfigurationCommand(
  command: CompatibleConfigurationInstallerCommand,
  runtime: CompatibleConfigurationCliRuntime,
): Promise<void> {
  if (command.type === "compatible-config-set") {
    reportOperation(
      await runtime.compatibleHttpConfigurationStore.write(command.configuration, command.dryRun),
      runtime,
    );
    return;
  }
  if (command.type === "compatible-config-remove") {
    reportOperation(await runtime.compatibleHttpConfigurationStore.remove(command.dryRun), runtime);
    return;
  }
  const configuration = await runtime.compatibleHttpConfigurationStore.read(
    new AbortController().signal,
  );
  runtime.writeOutput(`Base URL: ${configuration.baseUrl}`);
  runtime.writeOutput(`Model: ${configuration.model}`);
  runtime.writeOutput(`Effort: ${configuration.effort}`);
  runtime.writeOutput("WARNING: API credentials and selected text use plaintext HTTP.");
}

export function isCompatibleConfigurationCommand(command: {
  readonly type: string;
}): command is CompatibleConfigurationInstallerCommand {
  return (
    command.type === "compatible-config-set" ||
    command.type === "compatible-config-status" ||
    command.type === "compatible-config-remove"
  );
}

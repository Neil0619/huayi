import type { InstallerCommand, InstallerCliRuntime } from "./cli.js";
import {
  configureWindowsDeepSeekCredential,
  removeWindowsDeepSeekCredential,
} from "./windows-deepseek-credential.js";
import { createWindowsInstallationPaths } from "./windows-paths.js";
import {
  installWindowsNativeHost,
  uninstallWindowsNativeHost,
  type InstallWindowsNativeHostOptions,
  type UninstallWindowsNativeHostOptions,
  type WindowsInstallerResult,
} from "./windows.js";

interface WindowsInstallerOperations {
  install(options: InstallWindowsNativeHostOptions): Promise<WindowsInstallerResult>;
  uninstall(options: UninstallWindowsNativeHostOptions): Promise<WindowsInstallerResult>;
}

const defaultOperations: WindowsInstallerOperations = {
  install: installWindowsNativeHost,
  uninstall: uninstallWindowsNativeHost,
};

function report(actions: readonly string[], dryRun: boolean, runtime: InstallerCliRuntime): void {
  if (actions.length === 0) {
    runtime.writeOutput("No installed Huayi files were found.");
    return;
  }
  for (const action of actions) runtime.writeOutput(`${dryRun ? "[dry-run] " : ""}${action}`);
}

export async function executeWindowsInstallerCommand(
  command: Exclude<InstallerCommand, { type: "help" }>,
  runtime: InstallerCliRuntime,
  operations: WindowsInstallerOperations = defaultOperations,
): Promise<void> {
  const unsupported = new Set([
    "compatible-config-remove",
    "compatible-config-set",
    "compatible-config-status",
    "compatible-key-configure",
    "compatible-key-remove",
    "eudic-configure",
    "eudic-remove",
    "openai-configure",
    "openai-remove",
  ]);
  if (unsupported.has(command.type)) {
    throw new Error(`${command.type} is unavailable in Windows DeepSeek-only mode.`);
  }
  if (command.type === "provider-status") {
    runtime.writeOutput("deepseek-chat-completions");
    return;
  }
  if (command.type === "provider-set") {
    if (command.provider !== "deepseek-chat-completions") {
      throw new Error("Windows supports only the DeepSeek provider.");
    }
    runtime.writeOutput(`${command.dryRun ? "[dry-run] " : ""}Provider is fixed to DeepSeek.`);
    return;
  }

  const localAppDataDirectory = runtime.localAppDataDirectory ?? "";
  const paths = createWindowsInstallationPaths(localAppDataDirectory);
  const powershellExecutable = runtime.powershellExecutable ?? "";
  if (command.type === "deepseek-configure") {
    const result = await configureWindowsDeepSeekCredential({
      credentialHelperPath: paths.credentialHelperPath,
      credentialPath: paths.credentialPath,
      dryRun: command.dryRun,
      environment: runtime.environment,
      interactiveProcessRunner: runtime.interactiveProcessRunner,
      powershellExecutable,
      workingDirectory: paths.applicationDirectory,
    });
    report(result.actions, result.dryRun, runtime);
    return;
  }
  if (command.type === "deepseek-remove") {
    const result = await removeWindowsDeepSeekCredential({
      credentialHelperPath: paths.credentialHelperPath,
      credentialPath: paths.credentialPath,
      dryRun: command.dryRun,
      environment: runtime.environment,
      powershellExecutable,
      processRunner: runtime.processRunner,
      workingDirectory: paths.applicationDirectory,
    });
    report(result.actions, result.dryRun, runtime);
    return;
  }
  const registryExecutable = runtime.registryExecutable ?? "";
  if (command.type === "uninstall") {
    const result = await operations.uninstall({
      dryRun: command.dryRun,
      environment: runtime.environment,
      localAppDataDirectory,
      processRunner: runtime.processRunner,
      registryExecutable,
    });
    report(result.actions, result.dryRun, runtime);
    return;
  }
  if (command.type !== "install") {
    throw new Error(`${command.type} is unavailable in Windows DeepSeek-only mode.`);
  }
  if (command.codexPath !== undefined) {
    throw new Error("--codex-path is not accepted in Windows DeepSeek-only mode.");
  }
  const result = await operations.install({
    dryRun: command.dryRun,
    environment: runtime.environment,
    extensionId: command.extensionId,
    localAppDataDirectory,
    processRunner: runtime.processRunner,
    registryExecutable,
    sourceCredentialHelperPath: runtime.sourceWindowsCredentialHelperPath ?? "",
    sourceExecutablePath: runtime.sourceWindowsExecutablePath ?? "",
    sourceSchemaDirectory: runtime.sourceSchemaDirectory,
  });
  report(result.actions, result.dryRun, runtime);
}

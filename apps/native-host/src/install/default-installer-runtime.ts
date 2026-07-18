import { homedir } from "node:os";
import { win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { CompatibleHttpConfigurationStore } from "../config/compatible-http-configuration-store.js";
import { ProviderConfigurationStore } from "../config/provider-configuration-store.js";
import { OPENAI_SECURITY_EXECUTABLE } from "../credentials/openai-keychain.js";
import { NodeProcessRunner } from "../runtime/codex-process.js";
import type { InstallerCliRuntime } from "./cli.js";
import { compatibleCredentialCliOperations } from "./compatible-http-credential-cli.js";
import { deepSeekCredentialCliOperations } from "./deepseek-credential-cli.js";
import {
  configureEudicAuthorization,
  NodeInteractiveProcessRunner,
  removeEudicAuthorization,
} from "./eudic-keychain.js";
import { installMacosNativeHost, uninstallMacosNativeHost } from "./macos.js";
import { configureOpenAIApiKey, removeOpenAIApiKey } from "./openai-keychain.js";
import { createMacosInstallationPaths } from "./paths.js";

export function createDefaultInstallerRuntime(moduleUrl: string): InstallerCliRuntime {
  const homeDirectory = homedir();
  const macosPaths =
    process.platform === "darwin" ? createMacosInstallationPaths(homeDirectory) : null;
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return {
    compatibleCredentialOperations: compatibleCredentialCliOperations,
    compatibleHttpConfigurationStore: new CompatibleHttpConfigurationStore(
      macosPaths?.compatibleHttpConfigurationPath ??
        fileURLToPath(new URL("../unused-compatible.json", moduleUrl)),
    ),
    deepSeekCredentialOperations: deepSeekCredentialCliOperations,
    environment: process.env,
    homeDirectory,
    interactiveProcessRunner: new NodeInteractiveProcessRunner(),
    ...(process.env.LOCALAPPDATA === undefined
      ? {}
      : { localAppDataDirectory: process.env.LOCALAPPDATA }),
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
    powershellExecutable: win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    processRunner: new NodeProcessRunner(),
    providerConfigurationStore: new ProviderConfigurationStore(
      macosPaths?.providerConfigurationPath ??
        fileURLToPath(new URL("../unused-provider.json", moduleUrl)),
    ),
    registryExecutable: win32.join(systemRoot, "System32", "reg.exe"),
    securityExecutable: OPENAI_SECURITY_EXECUTABLE,
    sourceBundlePath: fileURLToPath(new URL("../main.js", moduleUrl)),
    sourceSchemaDirectory: fileURLToPath(new URL("../provider/schemas/", moduleUrl)),
    sourceWindowsDeepSeekCredentialHelperPath: fileURLToPath(
      new URL("../windows/deepseek-credential.ps1", moduleUrl),
    ),
    sourceWindowsEudicCredentialHelperPath: fileURLToPath(
      new URL("../windows/eudic-credential.ps1", moduleUrl),
    ),
    sourceWindowsExecutablePath: fileURLToPath(
      new URL("../windows/huayi-native-host.exe", moduleUrl),
    ),
    writeOutput: (message) => process.stdout.write(`${message}\n`),
  };
}

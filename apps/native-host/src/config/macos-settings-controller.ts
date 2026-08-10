import { dirname, resolve } from "node:path";

import {
  COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT,
  COMPATIBLE_HTTP_KEYCHAIN_SERVICE,
  COMPATIBLE_HTTP_SECURITY_EXECUTABLE,
} from "../credentials/compatible-http-keychain.js";
import {
  DEEPSEEK_KEYCHAIN_ACCOUNT,
  DEEPSEEK_KEYCHAIN_SERVICE,
  DEEPSEEK_SECURITY_EXECUTABLE,
} from "../credentials/deepseek-keychain.js";
import { EUDIC_KEYCHAIN_ACCOUNT, EUDIC_KEYCHAIN_SERVICE } from "../credentials/eudic-keychain.js";
import { MacosKeychainPresenceProbe } from "../credentials/macos-keychain-presence.js";
import {
  OPENAI_KEYCHAIN_ACCOUNT,
  OPENAI_KEYCHAIN_SERVICE,
  OPENAI_SECURITY_EXECUTABLE,
} from "../credentials/openai-keychain.js";
import { checkCodexCapabilities } from "../runtime/codex-capabilities.js";
import type { ProcessRunner } from "../runtime/codex-process.js";
import type { CompatibleHttpConfigurationStore } from "./compatible-http-configuration-store.js";
import type { ProviderConfigurationStore } from "./provider-configuration-store.js";
import { SettingsConfigurationController } from "./settings-configuration-controller.js";

export interface MacosSettingsControllerOptions {
  codexExecutable: string;
  compatibleConfigurationStore: CompatibleHttpConfigurationStore;
  environment: NodeJS.ProcessEnv;
  processRunner: ProcessRunner;
  providerStore: ProviderConfigurationStore;
  securityExecutable: string;
  workingDirectory: string;
}

export function createMacosSettingsController(
  options: MacosSettingsControllerOptions,
): SettingsConfigurationController {
  const presence = (account: string, service: string, securityExecutable: string) =>
    new MacosKeychainPresenceProbe({
      account,
      environment: options.environment,
      processRunner: options.processRunner,
      securityExecutable,
      service,
      workingDirectory: options.workingDirectory,
    });
  return new SettingsConfigurationController({
    codexProbe: {
      read: async (signal) => {
        signal.throwIfAborted();
        const result = await checkCodexCapabilities(options);
        signal.throwIfAborted();
        return result;
      },
    },
    compatibleConfigurationProbe: options.compatibleConfigurationStore,
    compatibleCredentialProbe: presence(
      COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT,
      COMPATIBLE_HTTP_KEYCHAIN_SERVICE,
      COMPATIBLE_HTTP_SECURITY_EXECUTABLE,
    ),
    deepSeekProbe: presence(
      DEEPSEEK_KEYCHAIN_ACCOUNT,
      DEEPSEEK_KEYCHAIN_SERVICE,
      DEEPSEEK_SECURITY_EXECUTABLE,
    ),
    openAIProbe: presence(
      OPENAI_KEYCHAIN_ACCOUNT,
      OPENAI_KEYCHAIN_SERVICE,
      OPENAI_SECURITY_EXECUTABLE,
    ),
    platform: "macos",
    providerStore: options.providerStore,
    wordbookProbe: presence(
      EUDIC_KEYCHAIN_ACCOUNT,
      EUDIC_KEYCHAIN_SERVICE,
      options.securityExecutable,
    ),
  });
}

export function compatibleConfigurationPath(providerConfigurationPath: string): string {
  return resolve(dirname(providerConfigurationPath), "compatible-http.json");
}

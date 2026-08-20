import type { AnalysisEngine } from "@huayi/store-domain";

import { BrowserAnalysisError } from "../analysis/analysis-error.js";
import type { CloudExtensionQueryApi } from "./cloud-extension-query-api.js";
import type { ExtensionPreferenceCache } from "./extension-preference-cache.js";
import type { ExtensionSessionVault } from "./extension-session-vault.js";
import { createPlatformAnalysisEngine } from "./platform-analysis-engine.js";
import { createQueryRouter } from "./query-router.js";

interface Options {
  readonly byok: AnalysisEngine;
  readonly cloudApi: CloudExtensionQueryApi | null;
  readonly preferences: ExtensionPreferenceCache;
  readonly sessionVault: Pick<ExtensionSessionVault, "readSession">;
  readonly sourceType: "web-selection" | "youtube-caption";
}

const unavailablePlatform: AnalysisEngine = {
  async analyze() {
    throw new BrowserAnalysisError("network-error");
  },
};

export function createProductionQueryEngine(options: Options): AnalysisEngine {
  const platform =
    options.cloudApi === null
      ? unavailablePlatform
      : createPlatformAnalysisEngine({
          api: options.cloudApi,
          readSession: () => options.sessionVault.readSession(),
          sourceType: options.sourceType,
        });
  return createQueryRouter({
    byok: options.byok,
    platform,
    readPreferences: () => options.preferences.read(),
    syncPreferences: () => options.preferences.sync(),
  });
}

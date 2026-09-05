import type { AnalysisEngine, DeviceVault } from "@huayi/store-domain";

import { BrowserAnalysisError } from "../analysis/analysis-error.js";
import type { CloudExtensionQueryApi } from "./cloud-extension-query-api.js";
import type { ExtensionPreferenceCache } from "./extension-preference-cache.js";
import type { ExtensionSessionVault } from "./extension-session-vault.js";
import { createPlatformAnalysisEngine } from "./platform-analysis-engine.js";
import { createQueryRouter } from "./query-router.js";
import type { QueryCache } from "./query-cache.js";
import { queryIdentity } from "./query-cache-storage.js";

interface Options {
  readonly byok: AnalysisEngine;
  readonly cache: QueryCache;
  readonly credentials: Pick<DeviceVault, "getCredential">;
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
  return {
    async analyze(request, signal, onUpdate) {
      const preferences = await options.preferences.read();
      const session = await options.sessionVault.readSession();
      if (preferences !== null && session === null)
        throw new BrowserAnalysisError("cloud-session-required");
      const mode = preferences?.extensionQueryModelMode ?? "byok";
      // Display cache and query dispatch never wait for the account's background refresh.
      void options.preferences.sync().catch(() => undefined);
      const platform =
        options.cloudApi === null
          ? unavailablePlatform
          : createPlatformAnalysisEngine({
              api: options.cloudApi,
              readSession: async () => {
                const current = await options.sessionVault.readSession();
                if (
                  !current ||
                  current.token !== session?.token ||
                  Date.parse(current.expiresAt) <= Date.now()
                ) {
                  throw new BrowserAnalysisError("cloud-session-required");
                }
                return current;
              },
              sourceType: options.sourceType,
            });
      const router = createQueryRouter({
        byok: options.byok,
        platform,
        readPreferences: async () => preferences,
        syncPreferences: async () => preferences,
      });
      const scope = await queryIdentity({
        session: session?.token ?? null,
        mode,
        revision: preferences?.revision ?? 0,
        source: options.sourceType,
        configuration: "query-stream-v2:deepseek-v4-flash",
        credential:
          mode === "byok"
            ? await options.credentials.getCredential(
                request.providerId === "openai" ? "openai-api-key" : "deepseek-api-key",
              )
            : null,
      });
      try {
        const result = await options.cache.analyze(scope, router, request, signal, onUpdate);
        const current = await options.sessionVault.readSession();
        if (
          current?.token !== session?.token ||
          (current && Date.parse(current.expiresAt) <= Date.now())
        ) {
          throw new BrowserAnalysisError("cloud-session-required");
        }
        return result;
      } catch (error) {
        if (
          error instanceof BrowserAnalysisError &&
          error.code === "cloud-session-required" &&
          session
        )
          await options.preferences.invalidate(session.token);
        throw error;
      }
    },
  };
}

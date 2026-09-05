import type { ExtensionPreferences } from "@huayi/cloud-contracts";

import type { CloudIdentityApi } from "./cloud-identity-api.js";
import type { ExtensionSessionVault } from "./extension-session-vault.js";
import type { StoredExtensionSession } from "./extension-session-vault.js";
import { BrowserAnalysisError } from "../analysis/analysis-error.js";
import { withCloudSessionLock } from "./cloud-session-lock.js";

interface ExtensionPreferenceCacheOptions {
  readonly api: CloudIdentityApi | null;
  readonly clearAccountData: () => Promise<void>;
  readonly now?: () => number;
  readonly vault: Pick<ExtensionSessionVault, "clearSession" | "readSession" | "writeSession">;
}

function httpStatus(error: unknown): unknown {
  return typeof error === "object" && error !== null && "status" in error ? error.status : null;
}

export function createExtensionPreferenceCache(options: ExtensionPreferenceCacheOptions) {
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, Promise<ExtensionPreferences | null>>();
  const validSession = async () => {
    const session = await options.vault.readSession();
    if (session === null) return null;
    if (Date.parse(session.expiresAt) > now()) return session;
    await Promise.all([options.vault.clearSession(), options.clearAccountData()]);
    throw new BrowserAnalysisError("cloud-session-required");
  };
  async function refresh(session: StoredExtensionSession): Promise<ExtensionPreferences | null> {
    if (options.api === null) return session.preferences;
    let current: ExtensionPreferences;
    try {
      current = await options.api.getExtensionPreferences(session.token);
    } catch (error) {
      return withCloudSessionLock(options.vault, async () => {
        const latest = await validSession();
        if (latest?.token !== session.token)
          throw new BrowserAnalysisError("cloud-session-required");
        if (httpStatus(error) === 401) {
          await Promise.all([options.vault.clearSession(), options.clearAccountData()]);
          return null;
        }
        if (httpStatus(error) === 403) throw new BrowserAnalysisError("cloud-access-denied");
        if (httpStatus(error) === 426) throw new BrowserAnalysisError("version-mismatch");
        return latest.preferences;
      });
    }
    return withCloudSessionLock(options.vault, async () => {
      const latest = await validSession();
      if (latest?.token !== session.token) throw new BrowserAnalysisError("cloud-session-required");
      const preferences =
        current.revision >= latest.preferences.revision ? current : latest.preferences;
      await options.vault.writeSession({ ...latest, preferences, preferencesSyncedAt: now() });
      return preferences;
    });
  }
  return {
    async invalidate(token: string): Promise<void> {
      await withCloudSessionLock(options.vault, async () => {
        if ((await options.vault.readSession())?.token !== token) return;
        await Promise.all([options.vault.clearSession(), options.clearAccountData()]);
      });
    },
    async read(): Promise<ExtensionPreferences | null> {
      return withCloudSessionLock(
        options.vault,
        async () => (await validSession())?.preferences ?? null,
      );
    },
    async sync(force = false): Promise<ExtensionPreferences | null> {
      const session = await withCloudSessionLock(options.vault, validSession);
      if (session === null || options.api === null) return session?.preferences ?? null;
      const age = now() - (session.preferencesSyncedAt ?? 0);
      if (!force && session.preferencesSyncedAt !== undefined && age >= 0 && age < 5 * 60_000)
        return session.preferences;
      const pending = inFlight.get(session.token);
      if (pending) return pending;
      const request = refresh(session).finally(() => {
        inFlight.delete(session.token);
      });
      inFlight.set(session.token, request);
      return request;
    },
  };
}

export type ExtensionPreferenceCache = ReturnType<typeof createExtensionPreferenceCache>;

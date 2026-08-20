import type { ExtensionPreferences } from "@huayi/cloud-contracts";

import type { CloudIdentityApi } from "./cloud-identity-api.js";
import type { ExtensionSessionVault } from "./extension-session-vault.js";

interface ExtensionPreferenceCacheOptions {
  readonly api: CloudIdentityApi | null;
  readonly clearAccountData: () => Promise<void>;
  readonly now?: () => number;
  readonly vault: Pick<ExtensionSessionVault, "clearSession" | "readSession" | "writeSession">;
}

function authenticationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 401 || error.status === 403)
  );
}

export function createExtensionPreferenceCache(options: ExtensionPreferenceCacheOptions) {
  const now = options.now ?? Date.now;
  const validSession = async () => {
    const session = await options.vault.readSession();
    if (session === null) return null;
    if (Date.parse(session.expiresAt) > now()) return session;
    await Promise.all([options.vault.clearSession(), options.clearAccountData()]);
    return null;
  };
  return {
    async read(): Promise<ExtensionPreferences | null> {
      return (await validSession())?.preferences ?? null;
    },
    async sync(): Promise<ExtensionPreferences | null> {
      const session = await validSession();
      if (session === null || options.api === null) return session?.preferences ?? null;
      try {
        const current = await options.api.getExtensionPreferences(session.token);
        const preferences =
          current.revision >= session.preferences.revision ? current : session.preferences;
        await options.vault.writeSession({ ...session, preferences });
        return preferences;
      } catch (error) {
        if (authenticationFailure(error)) {
          await Promise.all([options.vault.clearSession(), options.clearAccountData()]);
          return null;
        }
        return session.preferences;
      }
    },
  };
}

export type ExtensionPreferenceCache = ReturnType<typeof createExtensionPreferenceCache>;

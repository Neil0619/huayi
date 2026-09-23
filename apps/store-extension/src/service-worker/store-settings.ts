import {
  defaultActionSchema,
  keyboardShortcutSchema,
  overlayThemeSchema,
  providerIdSchema,
  recipientAccessDecision,
  sameStoreSiteRule,
  siteHostnameSchema,
  asbplayerModeSchema,
  type AsbplayerMode,
  upsertStoreSiteRule,
  normalizeStoreSiteRule,
  STORE_NETWORK_CONSENT_VERSION,
  STORE_RECIPIENT_CONSENT_VERSIONS,
  storeSettingsSchema,
  youtubeModeSchema,
  type ProviderId,
  type DataRecipient,
  type StoreSettings,
  type StoreSettingsRepository,
  type StoreSiteRule,
  type StoreSiteRuleKey,
  type StoreDefaultAction,
  type StoreKeyboardShortcut,
  type StoreOverlayTheme,
  type YouTubeMode,
} from "@huayi/store-domain";
import { DEFAULT_SETTINGS, migrateStoreSettings } from "./store-settings-migration.js";

const STORE_SETTINGS_STORAGE_KEY = "huayi.store.settings";

export interface ChromeSettingsStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  setAccessLevel(options: { readonly accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}

class RecipientConsentRequiredError extends Error {
  readonly code = "consent-required";
}

class ChromeStoreSettings implements StoreSettingsRepository {
  private operationQueue: Promise<void> = Promise.resolve();
  private preparation: Promise<void> | undefined;

  constructor(private readonly storage: ChromeSettingsStorageArea) {}

  get(): Promise<StoreSettings> {
    return this.exclusive(async () => this.read());
  }

  grantNetworkConsent(grantedAt: Date): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read();
      await this.write({
        ...current,
        networkConsent: {
          grantedAt: grantedAt.toISOString(),
          version: STORE_NETWORK_CONSENT_VERSION,
        },
      });
    });
  }

  grantRecipientConsent(recipient: DataRecipient, grantedAt: Date): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read();
      await this.write({
        ...current,
        recipientAccess: {
          ...current.recipientAccess,
          [recipient]: {
            consent: {
              grantedAt: grantedAt.toISOString(),
              version: STORE_RECIPIENT_CONSENT_VERSIONS[recipient],
            },
            enabled: false,
          },
        },
      });
    });
  }

  revokeNetworkConsent(): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read();
      await this.write({ ...current, networkConsent: null });
    });
  }

  revokeRecipientConsent(recipient: DataRecipient): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read();
      await this.write({
        ...current,
        recipientAccess: {
          ...current.recipientAccess,
          [recipient]: { consent: null, enabled: false },
        },
      });
    });
  }

  setDefaultAction(action: StoreDefaultAction): Promise<void> {
    return this.exclusive(async () => {
      const parsedAction = defaultActionSchema.parse(action);
      const current = await this.read();
      await this.write({ ...current, defaultAction: parsedAction });
    });
  }

  setRecipientEnabled(recipient: DataRecipient, enabled: boolean): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read();
      if (enabled && recipientAccessDecision(current, recipient) === "consent-required") {
        throw new RecipientConsentRequiredError();
      }
      await this.write({
        ...current,
        recipientAccess: {
          ...current.recipientAccess,
          [recipient]: { ...current.recipientAccess[recipient], enabled },
        },
      });
    });
  }

  setProvider(providerId: ProviderId): Promise<void> {
    return this.exclusive(async () => {
      const parsedProvider = providerIdSchema.parse(providerId);
      const current = await this.read();
      await this.write({ ...current, providerId: parsedProvider });
    });
  }

  setGloballyEnabled(enabled: boolean): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read();
      await this.write({ ...current, globallyEnabled: enabled });
    });
  }

  setOverlayTheme(theme: StoreOverlayTheme): Promise<void> {
    return this.exclusive(async () => {
      const parsedTheme = overlayThemeSchema.parse(theme);
      const current = await this.read();
      await this.write({ ...current, overlayTheme: parsedTheme });
    });
  }

  setSiteEnabled(host: string, enabled: boolean): Promise<void> {
    return this.exclusive(async () => {
      const rule: StoreSiteRule = {
        action: enabled ? "allow" : "block",
        hostname: siteHostnameSchema.parse(host),
        includeSubdomains: false,
      };
      const current = await this.read();
      await this.write({ ...current, sitePolicy: upsertStoreSiteRule(current.sitePolicy, rule) });
    });
  }

  upsertSiteRule(rule: StoreSiteRule, previous?: StoreSiteRuleKey): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read();
      const normalized = normalizeStoreSiteRule(rule, (value) => new URL(value));
      await this.write({
        ...current,
        sitePolicy: upsertStoreSiteRule(current.sitePolicy, normalized, previous),
      });
    });
  }

  removeSiteRule(key: StoreSiteRuleKey): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read();
      const rules = current.sitePolicy.rules.filter((rule) => !sameStoreSiteRule(rule, key));
      await this.write({ ...current, sitePolicy: { ...current.sitePolicy, rules } });
    });
  }

  setYoutubeMode(mode: YouTubeMode): Promise<void> {
    return this.exclusive(async () => {
      const parsedMode = youtubeModeSchema.parse(mode);
      const current = await this.read();
      await this.write({ ...current, youtubeMode: parsedMode });
    });
  }

  setYoutubeShortcut(shortcut: StoreKeyboardShortcut | null): Promise<void> {
    return this.exclusive(async () => {
      const parsedShortcut = keyboardShortcutSchema.nullable().parse(shortcut);
      const current = await this.read();
      await this.write({ ...current, youtubeShortcut: parsedShortcut });
    });
  }

  setAsbplayerMode(mode: AsbplayerMode): Promise<void> {
    return this.exclusive(async () => {
      const parsedMode = asbplayerModeSchema.parse(mode);
      const current = await this.read();
      await this.write({ ...current, asbplayerMode: parsedMode });
    });
  }

  setAsbplayerShortcut(shortcut: StoreKeyboardShortcut | null): Promise<void> {
    return this.exclusive(async () => {
      const parsedShortcut = keyboardShortcutSchema.nullable().parse(shortcut);
      const current = await this.read();
      await this.write({ ...current, asbplayerShortcut: parsedShortcut });
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private prepare(): Promise<void> {
    this.preparation ??= this.storage.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    return this.preparation;
  }

  private async read(): Promise<StoreSettings> {
    await this.prepare();
    const values = await this.storage.get(STORE_SETTINGS_STORAGE_KEY);
    const persisted = values[STORE_SETTINGS_STORAGE_KEY];
    if (persisted === undefined) return structuredClone(DEFAULT_SETTINGS);
    const current = storeSettingsSchema.safeParse(persisted);
    if (current.success) return current.data;
    const migrated = migrateStoreSettings(persisted);
    await this.write(migrated);
    return migrated;
  }

  private async write(settings: StoreSettings): Promise<void> {
    await this.prepare();
    await this.storage.set({ [STORE_SETTINGS_STORAGE_KEY]: storeSettingsSchema.parse(settings) });
  }
}

export function createChromeStoreSettings(
  storage: ChromeSettingsStorageArea,
): StoreSettingsRepository {
  return new ChromeStoreSettings(storage);
}

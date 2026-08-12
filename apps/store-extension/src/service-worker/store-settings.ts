import {
  defaultActionSchema,
  keyboardShortcutSchema,
  overlayThemeSchema,
  providerIdSchema,
  recipientAccessDecision,
  siteHostnameSchema,
  STORE_NETWORK_CONSENT_VERSION,
  STORE_RECIPIENT_CONSENT_VERSIONS,
  STORE_SETTINGS_SCHEMA_VERSION,
  storeSettingsSchema,
  youtubeModeSchema,
  type ProviderId,
  type DataRecipient,
  type StoreSettings,
  type StoreSettingsRepository,
  type StoreDefaultAction,
  type StoreKeyboardShortcut,
  type StoreOverlayTheme,
  type YouTubeMode,
} from "@huayi/store-domain";
import { z } from "zod/v3";

const STORE_SETTINGS_STORAGE_KEY = "huayi.store.settings";

export interface ChromeSettingsStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  setAccessLevel(options: { readonly accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}

const DEFAULT_SETTINGS: StoreSettings = {
  defaultAction: "ask",
  globallyEnabled: true,
  networkConsent: null,
  overlayTheme: "pearl",
  providerId: "openai",
  recipientAccess: {
    eudic: { consent: null, enabled: false },
    shanbay: { consent: null, enabled: false },
  },
  schemaVersion: STORE_SETTINGS_SCHEMA_VERSION,
  sitePolicy: { defaultAction: "allow", rules: [] },
  youtubeMode: "english",
  youtubeShortcut: null,
};

const legacySettingsSchema = z.strictObject({
  networkConsent: z
    .strictObject({
      grantedAt: z.string().datetime({ offset: true }),
      version: z.literal(STORE_NETWORK_CONSENT_VERSION),
    })
    .nullable(),
  providerId: providerIdSchema,
  schemaVersion: z.literal(1),
});

const versionTwoSettingsSchema = z.strictObject({
  networkConsent: legacySettingsSchema.shape.networkConsent,
  providerId: providerIdSchema,
  recipientAccess: storeSettingsSchema.shape.recipientAccess,
  schemaVersion: z.literal(2),
});

const versionThreeSettingsSchema = z.strictObject({
  networkConsent: legacySettingsSchema.shape.networkConsent,
  providerId: providerIdSchema,
  recipientAccess: storeSettingsSchema.shape.recipientAccess,
  schemaVersion: z.literal(3),
  youtubeMode: youtubeModeSchema,
});

const versionFourSettingsSchema = z.strictObject({
  disabledHosts: z
    .array(siteHostnameSchema)
    .max(256)
    .refine((hosts) =>
      hosts.every((host, index) => {
        const previous = hosts[index - 1];
        return previous === undefined || previous < host;
      }),
    ),
  globallyEnabled: z.boolean(),
  networkConsent: legacySettingsSchema.shape.networkConsent,
  providerId: providerIdSchema,
  recipientAccess: storeSettingsSchema.shape.recipientAccess,
  schemaVersion: z.literal(4),
  youtubeMode: youtubeModeSchema,
});

const versionFiveSettingsSchema = storeSettingsSchema
  .omit({ overlayTheme: true, schemaVersion: true })
  .extend({ schemaVersion: z.literal(5) });

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
      const parsedHost = siteHostnameSchema.parse(host);
      const current = await this.read();
      const rules = [
        ...current.sitePolicy.rules.filter(
          (rule) => rule.hostname !== parsedHost || rule.includeSubdomains,
        ),
        {
          action: enabled ? ("allow" as const) : ("block" as const),
          hostname: parsedHost,
          includeSubdomains: false,
        },
      ].sort(
        (left, right) =>
          left.hostname.localeCompare(right.hostname) ||
          Number(left.includeSubdomains) - Number(right.includeSubdomains),
      );
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
    const versionFive = versionFiveSettingsSchema.safeParse(persisted);
    if (versionFive.success) {
      const migrated: StoreSettings = {
        ...versionFive.data,
        overlayTheme: DEFAULT_SETTINGS.overlayTheme,
        schemaVersion: STORE_SETTINGS_SCHEMA_VERSION,
      };
      await this.write(migrated);
      return migrated;
    }
    const versionFour = versionFourSettingsSchema.safeParse(persisted);
    if (versionFour.success) {
      const { disabledHosts, ...retained } = versionFour.data;
      const migrated: StoreSettings = {
        ...retained,
        defaultAction: DEFAULT_SETTINGS.defaultAction,
        overlayTheme: DEFAULT_SETTINGS.overlayTheme,
        schemaVersion: STORE_SETTINGS_SCHEMA_VERSION,
        sitePolicy: {
          defaultAction: "allow",
          rules: disabledHosts.map((hostname) => ({
            action: "block",
            hostname,
            includeSubdomains: false,
          })),
        },
        youtubeShortcut: DEFAULT_SETTINGS.youtubeShortcut,
      };
      await this.write(migrated);
      return migrated;
    }
    const versionThree = versionThreeSettingsSchema.safeParse(persisted);
    if (versionThree.success) {
      const migrated: StoreSettings = {
        defaultAction: DEFAULT_SETTINGS.defaultAction,
        globallyEnabled: true,
        overlayTheme: DEFAULT_SETTINGS.overlayTheme,
        ...versionThree.data,
        schemaVersion: STORE_SETTINGS_SCHEMA_VERSION,
        sitePolicy: structuredClone(DEFAULT_SETTINGS.sitePolicy),
        youtubeShortcut: DEFAULT_SETTINGS.youtubeShortcut,
      };
      await this.write(migrated);
      return migrated;
    }
    const versionTwo = versionTwoSettingsSchema.safeParse(persisted);
    if (versionTwo.success) {
      const migrated: StoreSettings = {
        defaultAction: DEFAULT_SETTINGS.defaultAction,
        globallyEnabled: true,
        overlayTheme: DEFAULT_SETTINGS.overlayTheme,
        ...versionTwo.data,
        schemaVersion: STORE_SETTINGS_SCHEMA_VERSION,
        sitePolicy: structuredClone(DEFAULT_SETTINGS.sitePolicy),
        youtubeMode: DEFAULT_SETTINGS.youtubeMode,
        youtubeShortcut: DEFAULT_SETTINGS.youtubeShortcut,
      };
      await this.write(migrated);
      return migrated;
    }
    const legacy = legacySettingsSchema.safeParse(persisted);
    if (!legacy.success) throw current.error;
    const migrated: StoreSettings = {
      defaultAction: DEFAULT_SETTINGS.defaultAction,
      globallyEnabled: true,
      networkConsent: legacy.data.networkConsent,
      overlayTheme: DEFAULT_SETTINGS.overlayTheme,
      providerId: legacy.data.providerId,
      recipientAccess: structuredClone(DEFAULT_SETTINGS.recipientAccess),
      schemaVersion: STORE_SETTINGS_SCHEMA_VERSION,
      sitePolicy: structuredClone(DEFAULT_SETTINGS.sitePolicy),
      youtubeMode: DEFAULT_SETTINGS.youtubeMode,
      youtubeShortcut: DEFAULT_SETTINGS.youtubeShortcut,
    };
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

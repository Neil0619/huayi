import {
  providerIdSchema,
  siteHostnameSchema,
  STORE_NETWORK_CONSENT_VERSION,
  STORE_SETTINGS_SCHEMA_VERSION,
  storeSettingsSchema,
  youtubeModeSchema,
  type StoreDefaultAction,
  type StoreSettings,
} from "@huayi/store-domain";
import { z } from "zod/v3";

export const DEFAULT_SETTINGS: StoreSettings = {
  asbplayerMode: "english",
  asbplayerShortcut: null,
  defaultAction: "translate",
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

const LEGACY_DEFAULT_ACTION: StoreDefaultAction = "ask";

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
  .omit({ asbplayerMode: true, asbplayerShortcut: true, overlayTheme: true, schemaVersion: true })
  .extend({ schemaVersion: z.literal(5) });

const versionSixSettingsSchema = storeSettingsSchema
  .omit({ asbplayerMode: true, asbplayerShortcut: true, schemaVersion: true })
  .extend({ schemaVersion: z.literal(6) });

/** Pure migration; caller must persist before exposing a migrated record. */
export function migrateStoreSettings(value: unknown): StoreSettings {
  const defaults = structuredClone(DEFAULT_SETTINGS);
  const current = storeSettingsSchema.safeParse(value);
  if (current.success) return current.data;
  for (const schema of [versionSixSettingsSchema, versionFiveSettingsSchema]) {
    const old = schema.safeParse(value);
    if (old.success)
      return storeSettingsSchema.parse({
        ...defaults,
        ...old.data,
        schemaVersion: STORE_SETTINGS_SCHEMA_VERSION,
        asbplayerShortcut: old.data.youtubeShortcut,
      });
  }
  const four = versionFourSettingsSchema.safeParse(value);
  if (four.success) {
    const { disabledHosts, ...retained } = four.data;
    return storeSettingsSchema.parse({
      ...defaults,
      ...retained,
      defaultAction: LEGACY_DEFAULT_ACTION,
      schemaVersion: STORE_SETTINGS_SCHEMA_VERSION,
      sitePolicy: {
        defaultAction: "allow",
        rules: disabledHosts.map((hostname) => ({
          action: "block",
          hostname,
          includeSubdomains: false,
        })),
      },
    });
  }
  for (const schema of [
    versionThreeSettingsSchema,
    versionTwoSettingsSchema,
    legacySettingsSchema,
  ]) {
    const old = schema.safeParse(value);
    if (old.success)
      return storeSettingsSchema.parse({
        ...defaults,
        ...old.data,
        defaultAction: LEGACY_DEFAULT_ACTION,
        schemaVersion: STORE_SETTINGS_SCHEMA_VERSION,
      });
  }
  throw current.error;
}

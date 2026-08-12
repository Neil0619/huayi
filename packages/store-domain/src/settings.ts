import { z } from "zod/v3";

import { providerIdSchema } from "./analysis.js";

export const STORE_SETTINGS_SCHEMA_VERSION = 6;
export const STORE_SITE_RULE_LIMIT = 256;
export const STORE_NETWORK_CONSENT_VERSION = 1;
export const STORE_RECIPIENT_CONSENT_VERSIONS = {
  eudic: 1,
  shanbay: 1,
} as const;

export const dataRecipientSchema = z.enum(["eudic", "shanbay"]);
export type DataRecipient = z.infer<typeof dataRecipientSchema>;

export const recipientConsentSchema = z.strictObject({
  grantedAt: z.string().datetime({ offset: true }),
  version: z.number().int().nonnegative().safe(),
});
export type RecipientConsent = z.infer<typeof recipientConsentSchema>;

export const recipientAccessSchema = z.strictObject({
  consent: recipientConsentSchema.nullable(),
  enabled: z.boolean(),
});
export type RecipientAccess = z.infer<typeof recipientAccessSchema>;

export const networkConsentSchema = z.strictObject({
  grantedAt: z.string().datetime({ offset: true }),
  version: z.literal(STORE_NETWORK_CONSENT_VERSION),
});
export type NetworkConsent = z.infer<typeof networkConsentSchema>;

export const youtubeModeSchema = z.enum(["disabled", "english", "bilingual"]);
export type YouTubeMode = z.infer<typeof youtubeModeSchema>;

export const defaultActionSchema = z.enum(["ask", "explain", "translate"]);
export type StoreDefaultAction = z.infer<typeof defaultActionSchema>;

export const overlayThemeSchema = z.enum(["parchment", "pearl"]);
export type StoreOverlayTheme = z.infer<typeof overlayThemeSchema>;

export const siteActionSchema = z.enum(["allow", "block"]);
export type StoreSiteAction = z.infer<typeof siteActionSchema>;

export const siteHostnameSchema = z
  .string()
  .min(1)
  .max(253)
  .refine(
    (value) => value === value.trim() && value === value.toLowerCase() && !/[\s/?#]/u.test(value),
    "Site host must be a canonical hostname.",
  );

export const storeSiteRuleSchema = z.strictObject({
  action: siteActionSchema,
  hostname: siteHostnameSchema,
  includeSubdomains: z.boolean(),
});
export type StoreSiteRule = z.infer<typeof storeSiteRuleSchema>;

export const storeSitePolicySchema = z.strictObject({
  defaultAction: siteActionSchema,
  rules: z
    .array(storeSiteRuleSchema)
    .max(STORE_SITE_RULE_LIMIT)
    .refine(
      (rules) =>
        rules.every((rule, index) => {
          const previous = rules[index - 1];
          if (previous === undefined) return true;
          const previousKey = `${previous.hostname}\u0000${String(previous.includeSubdomains)}`;
          const currentKey = `${rule.hostname}\u0000${String(rule.includeSubdomains)}`;
          return previousKey < currentKey;
        }),
      "Site rules must be unique and sorted by hostname and scope.",
    ),
});
export type StoreSitePolicy = z.infer<typeof storeSitePolicySchema>;

export const keyboardShortcutSchema = z
  .strictObject({
    alt: z.boolean(),
    code: z.string().regex(/^(?:Key[A-Z]|Digit\d|F(?:[1-9]|1\d|2[0-4]))$/u),
    ctrl: z.boolean(),
    meta: z.boolean(),
    shift: z.boolean(),
  })
  .refine((shortcut) => shortcut.alt || shortcut.ctrl || shortcut.meta || shortcut.shift);
export type StoreKeyboardShortcut = z.infer<typeof keyboardShortcutSchema>;

export const storeSettingsSchema = z.strictObject({
  defaultAction: defaultActionSchema,
  globallyEnabled: z.boolean(),
  networkConsent: networkConsentSchema.nullable(),
  overlayTheme: overlayThemeSchema,
  providerId: providerIdSchema,
  recipientAccess: z.strictObject({
    eudic: recipientAccessSchema,
    shanbay: recipientAccessSchema,
  }),
  schemaVersion: z.literal(STORE_SETTINGS_SCHEMA_VERSION),
  sitePolicy: storeSitePolicySchema,
  youtubeMode: youtubeModeSchema,
  youtubeShortcut: keyboardShortcutSchema.nullable(),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export function evaluateSiteAction(
  settings: Pick<StoreSettings, "globallyEnabled" | "sitePolicy">,
  host: string,
): StoreSiteAction {
  if (!settings.globallyEnabled) return "block";
  const matches = settings.sitePolicy.rules
    .filter(
      (rule) =>
        host === rule.hostname || (rule.includeSubdomains && host.endsWith(`.${rule.hostname}`)),
    )
    .sort(
      (left, right) =>
        right.hostname.split(".").length - left.hostname.split(".").length ||
        right.hostname.length - left.hostname.length ||
        Number(left.includeSubdomains) - Number(right.includeSubdomains),
    );
  return matches[0]?.action ?? settings.sitePolicy.defaultAction;
}

export function isSiteEnabled(
  settings: Pick<StoreSettings, "globallyEnabled" | "sitePolicy">,
  host: string,
): boolean {
  return evaluateSiteAction(settings, host) === "allow";
}

export type RecipientAccessDecision = "allowed" | "consent-required" | "recipient-disabled";

export function recipientAccessDecision(
  settings: Pick<StoreSettings, "recipientAccess">,
  recipient: DataRecipient,
): RecipientAccessDecision {
  const access = settings.recipientAccess[recipient];
  if (access.consent?.version !== STORE_RECIPIENT_CONSENT_VERSIONS[recipient]) {
    return "consent-required";
  }
  return access.enabled ? "allowed" : "recipient-disabled";
}

export interface StoreSettingsRepository {
  get(): Promise<StoreSettings>;
  grantNetworkConsent(grantedAt: Date): Promise<void>;
  grantRecipientConsent(recipient: DataRecipient, grantedAt: Date): Promise<void>;
  revokeNetworkConsent(): Promise<void>;
  revokeRecipientConsent(recipient: DataRecipient): Promise<void>;
  setRecipientEnabled(recipient: DataRecipient, enabled: boolean): Promise<void>;
  setDefaultAction(action: StoreDefaultAction): Promise<void>;
  setProvider(providerId: StoreSettings["providerId"]): Promise<void>;
  setGloballyEnabled(enabled: boolean): Promise<void>;
  setOverlayTheme(theme: StoreOverlayTheme): Promise<void>;
  setSiteEnabled(host: string, enabled: boolean): Promise<void>;
  setYoutubeMode(mode: YouTubeMode): Promise<void>;
  setYoutubeShortcut(shortcut: StoreKeyboardShortcut | null): Promise<void>;
}

import { z } from "zod/v3";

import { resourceIdSchema } from "./common-contracts.js";

const opaqueTokenSchema = z.string().min(32).max(2_048);
export const accountEmailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(12).max(256);
const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Expected a valid IANA time zone.");

export const identityHttpRoutes = {
  account: "/v1/account",
  accountSignInMethods: "/v1/account/sign-in-methods",
  accountPreferences: "/v1/account/preferences",
  claimInvitation: "/v1/invitations/claim",
  csrf: "/v1/auth/csrf",
  googleAuthStart: "/v1/auth/google/start",
  googleLinkContinue: "/v1/account/sign-in-methods/google:continue",
  googleLinkStart: "/v1/account/sign-in-methods/google:start",
  googleLoginStart: "/v1/auth/google/login/start",
  googleReauthenticationContinue: "/v1/auth/reauthenticate/google/continue",
  googleReauthenticationStart: "/v1/auth/reauthenticate/google/start",
  passwordLink: "/v1/account/sign-in-methods/password",
  passwordLogin: "/v1/auth/password/login",
  passwordReauthentication: "/v1/auth/reauthenticate/password",
  passwordRegister: "/v1/auth/password/register",
  passwordRegistrationResume: "/v1/auth/password/register/resume",
  quota: "/v1/quota",
  extensionPairingCreate: "/v1/extension-pairings",
  extensionPairing: "/v1/extension-pairings/:id",
  extensionPairingApprove: "/v1/extension-pairings/:id/approve",
  extensionPairingExchange: "/v1/extension-pairings/:id/exchange",
  extensionPreferences: "/v1/extension-preferences",
  extensionSessionCurrent: "/v1/extension-session",
  extensionSessions: "/v1/extension-sessions",
  extensionSession: "/v1/extension-sessions/:id",
} as const;

export const signInMethodSchema = z.enum(["password", "google"]);
export type SignInMethod = z.infer<typeof signInMethodSchema>;
const signInMethodOrder: Record<SignInMethod, number> = { password: 0, google: 1 };
export const accountSignInMethodsResponseSchema = z.strictObject({
  methods: z
    .array(
      z.strictObject({
        linkedAt: z.string().datetime({ offset: true }),
        method: signInMethodSchema,
      }),
    )
    .min(1)
    .max(2)
    .refine(
      (methods) =>
        new Set(methods.map(({ method }) => method)).size === methods.length &&
        methods.every(({ method }, index) => {
          const previous = methods[index - 1];
          return (
            previous === undefined || signInMethodOrder[previous.method] < signInMethodOrder[method]
          );
        }),
      "Expected unique sign-in methods in canonical order.",
    ),
});
export type AccountSignInMethodsResponse = z.infer<typeof accountSignInMethodsResponseSchema>;
export const passwordReauthenticationRequestSchema = z.strictObject({
  password: passwordSchema,
});
export const passwordReauthenticationResponseSchema = z.strictObject({
  access: z.literal("full"),
  csrfToken: opaqueTokenSchema,
});
export const googleReauthenticationStartRequestSchema = z.strictObject({});
export const googleReauthenticationStartResponseSchema = z.strictObject({
  continuePath: z.literal(identityHttpRoutes.googleReauthenticationContinue),
});
export const googleLinkStartRequestSchema = z.strictObject({});
export const googleLinkStartResponseSchema = z.strictObject({
  continuePath: z.literal(identityHttpRoutes.googleLinkContinue),
});
export const passwordLinkRequestSchema = z.strictObject({ password: passwordSchema });
export const passwordLinkResponseSchema = accountSignInMethodsResponseSchema;
export const googleLoginStartRequestSchema = z.strictObject({});

export const webSessionAccessSchema = z.enum(["full", "data-rights"]);
export type WebSessionAccess = z.infer<typeof webSessionAccessSchema>;
export const csrfTokenResponseSchema = z.strictObject({
  access: webSessionAccessSchema,
  csrfToken: opaqueTokenSchema,
});

export const claimInvitationRequestSchema = z.strictObject({ invitationToken: opaqueTokenSchema });
export const claimInvitationResponseSchema = z.strictObject({
  claimTicket: opaqueTokenSchema,
  expiresAt: z.string().datetime({ offset: true }),
});
export const passwordRegistrationRequestSchema = z.strictObject({
  claimTicket: opaqueTokenSchema,
  email: accountEmailSchema,
  password: passwordSchema,
});
export const passwordRegistrationResumeRequestSchema = z.strictObject({
  email: accountEmailSchema,
  invitationToken: opaqueTokenSchema,
  password: passwordSchema,
});
export const passwordRegistrationResponseSchema = z.union([
  z.strictObject({ emailConfirmationRequired: z.literal(true) }),
  z.strictObject({
    access: z.literal("full"),
    csrfToken: opaqueTokenSchema,
    emailConfirmationRequired: z.literal(false),
  }),
]);
export const googleAuthStartRequestSchema = z.strictObject({ claimTicket: opaqueTokenSchema });
export const passwordLoginRequestSchema = z.strictObject({
  email: accountEmailSchema,
  password: passwordSchema,
});
export const passwordLoginResponseSchema = csrfTokenResponseSchema;
const extensionPreferenceFields = {
  cloudWordCopyMode: z.enum(["enabled", "disabled"]),
  extensionQueryModelMode: z.enum(["platform", "byok"]),
  studyCaptureMode: z.enum(["manual", "automatic"]),
};
const accountPreferenceFields = {
  dailyGoal: z.number().int().min(1).max(100),
  ...extensionPreferenceFields,
  timezone: timeZoneSchema,
};
export const accountPreferencesRequestSchema = z
  .strictObject({
    cloudWordCopyMode: extensionPreferenceFields.cloudWordCopyMode.optional(),
    dailyGoal: accountPreferenceFields.dailyGoal.optional(),
    expectedRevision: z.number().int().min(1),
    extensionQueryModelMode: extensionPreferenceFields.extensionQueryModelMode.optional(),
    studyCaptureMode: extensionPreferenceFields.studyCaptureMode.optional(),
    timezone: timeZoneSchema.optional(),
  })
  .refine(
    (value) =>
      value.cloudWordCopyMode !== undefined ||
      value.dailyGoal !== undefined ||
      value.extensionQueryModelMode !== undefined ||
      value.studyCaptureMode !== undefined ||
      value.timezone !== undefined,
    { message: "At least one preference must change." },
  );
export type AccountPreferencesRequest = z.infer<typeof accountPreferencesRequestSchema>;
export const accountPreferencesResponseSchema = z.strictObject({
  ...accountPreferenceFields,
  revision: z.number().int().min(1),
  updatedAt: z.string().datetime({ offset: true }),
});
export type AccountPreferences = z.infer<typeof accountPreferencesResponseSchema>;
export const extensionPreferencesResponseSchema = z.strictObject({
  ...extensionPreferenceFields,
  revision: z.number().int().min(1),
  updatedAt: z.string().datetime({ offset: true }),
});
export type ExtensionPreferences = z.infer<typeof extensionPreferencesResponseSchema>;
export const createExtensionPairingRequestSchema = z.strictObject({
  installIdHash: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
  pkceChallenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
  state: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
});
export const extensionPairingResponseSchema = z.strictObject({
  expiresAt: z.string().datetime({ offset: true }),
  id: resourceIdSchema,
  pairingPath: z.string().regex(/^\/pair-extension\/[A-Za-z0-9_-]{1,128}$/u),
  status: z.enum(["pending", "approved", "expired"]),
});
export const approveExtensionPairingRequestSchema = z.strictObject({
  ...extensionPreferenceFields,
  deviceLabel: z.string().trim().min(1).max(100),
  expectedPreferencesRevision: z.number().int().min(1),
});
export type ApproveExtensionPairingRequest = z.infer<typeof approveExtensionPairingRequestSchema>;
export const exchangeExtensionPairingRequestSchema = z.strictObject({
  pkceVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/u),
  state: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
});
export const extensionSessionTokenResponseSchema = z.strictObject({
  expiresAt: z.string().datetime({ offset: true }),
  sessionToken: opaqueTokenSchema,
});
export const extensionPairingExchangeResponseSchema = z.strictObject({
  expiresAt: z.string().datetime({ offset: true }),
  preferences: extensionPreferencesResponseSchema,
  sessionToken: opaqueTokenSchema,
});

export const extensionSessionResourceSchema = z.strictObject({
  createdAt: z.string().datetime({ offset: true }),
  deviceLabel: z.string().trim().min(1).max(100),
  expiresAt: z.string().datetime({ offset: true }),
  id: resourceIdSchema,
  lastUsedAt: z.string().datetime({ offset: true }).nullable(),
});
export type ExtensionSessionResource = z.infer<typeof extensionSessionResourceSchema>;
export const extensionSessionListResponseSchema = z.strictObject({
  items: z.array(extensionSessionResourceSchema).max(100),
});
export function isSafeExtensionVersion(value: string): boolean {
  return (
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value) &&
    value.split(".").every((part) => Number.isSafeInteger(Number(part)))
  );
}
export const extensionVersionSchema = z.string().refine(isSafeExtensionVersion, {
  message: "Expected a three-part safe-integer Extension version.",
});
export const accountResourceSchema = z.strictObject({
  email: accountEmailSchema,
  extensionSessions: z.array(extensionSessionResourceSchema).max(100),
  minSupportedExtensionVersion: extensionVersionSchema,
  preferences: accountPreferencesResponseSchema,
});
export type AccountResource = z.infer<typeof accountResourceSchema>;

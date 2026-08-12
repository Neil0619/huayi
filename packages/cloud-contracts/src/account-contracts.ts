import { z } from "zod/v3";

import { resourceIdSchema } from "./common-contracts.js";

const opaqueTokenSchema = z.string().min(32).max(2_048);
const emailSchema = z.string().email().max(320);
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

export const claimInvitationRequestSchema = z.strictObject({ invitationToken: opaqueTokenSchema });
export const claimInvitationResponseSchema = z.strictObject({
  claimTicket: opaqueTokenSchema,
  expiresAt: z.string().datetime({ offset: true }),
});
export const passwordRegistrationRequestSchema = z.strictObject({
  claimTicket: opaqueTokenSchema,
  email: emailSchema,
  password: passwordSchema,
});
export const passwordLoginRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
});
export const accountPreferencesRequestSchema = z.strictObject({
  dailyGoal: z.number().int().min(1).max(100),
  timezone: timeZoneSchema,
});
export const accountDeleteRequestSchema = z.strictObject({
  confirmation: z.literal("DELETE MY HUAYI ACCOUNT"),
  reauthenticationProof: opaqueTokenSchema,
});

export const createExtensionPairingRequestSchema = z.strictObject({
  installIdHash: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
  pkceChallenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
  state: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
});
export const extensionPairingResponseSchema = z.strictObject({
  expiresAt: z.string().datetime({ offset: true }),
  id: resourceIdSchema,
  pairingPath: z.string().regex(/^\/pair-extension\/[A-Za-z0-9_-]{1,128}$/u),
  status: z.enum(["pending", "approved", "expired", "consumed"]),
});
export const approveExtensionPairingRequestSchema = z.strictObject({
  deviceLabel: z.string().trim().min(1).max(100),
});
export const exchangeExtensionPairingRequestSchema = z.strictObject({
  pkceVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/u),
  state: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
});
export const extensionSessionTokenResponseSchema = z.strictObject({
  expiresAt: z.string().datetime({ offset: true }),
  sessionToken: opaqueTokenSchema,
});

export const extensionSessionResourceSchema = z.strictObject({
  createdAt: z.string().datetime({ offset: true }),
  deviceLabel: z.string().trim().min(1).max(100),
  expiresAt: z.string().datetime({ offset: true }),
  id: resourceIdSchema,
  lastUsedAt: z.string().datetime({ offset: true }).nullable(),
});
export const accountResourceSchema = z.strictObject({
  consentVersion: z.string().trim().min(1).max(64),
  dailyGoal: z.number().int().min(1).max(100),
  extensionSessions: z.array(extensionSessionResourceSchema).max(100),
  minSupportedExtensionVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  status: z.enum(["active", "disabled", "deleting"]),
  timezone: timeZoneSchema,
});

export const exportJobResourceSchema = z.strictObject({
  createdAt: z.string().datetime({ offset: true }),
  downloadExpiresAt: z.string().datetime({ offset: true }).optional(),
  downloadPath: z
    .string()
    .regex(/^\/v1\/account\/exports\/[A-Za-z0-9_-]{1,128}\/download$/u)
    .optional(),
  id: resourceIdSchema,
  status: z.enum(["pending", "ready", "failed", "expired"]),
});

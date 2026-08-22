import { z } from "zod/v3";

import { accountEmailSchema } from "./account-contracts.js";

const recoveryProofSchema = z.string().min(32).max(2_048);

export const passwordRecoveryHttpRoutes = {
  callback: "/v1/auth/password/recovery/callback",
  complete: "/v1/auth/password/recovery/complete",
  confirm: "/v1/auth/password/recovery/confirm",
  run: "/internal/password-recovery/run",
  session: "/v1/auth/password/recovery/session",
  start: "/v1/auth/password/recovery",
} as const;

export const passwordRecoveryStartRequestSchema = z.strictObject({
  email: accountEmailSchema,
});
export type PasswordRecoveryStartRequest = z.infer<typeof passwordRecoveryStartRequestSchema>;

export const passwordRecoveryAcceptedResponseSchema = z.strictObject({
  accepted: z.literal(true),
});
export type PasswordRecoveryAcceptedResponse = z.infer<
  typeof passwordRecoveryAcceptedResponseSchema
>;

const passwordRecoveryEmailProofFields = {
  code: recoveryProofSchema,
  flow: recoveryProofSchema,
};
export const passwordRecoveryConfirmQuerySchema = z.strictObject(passwordRecoveryEmailProofFields);
export const passwordRecoveryCallbackFormSchema = z.strictObject(passwordRecoveryEmailProofFields);

export const passwordRecoverySessionResponseSchema = z.strictObject({
  csrfToken: z.string().min(32).max(256),
  expiresAt: z.string().datetime({ offset: true }),
});
export type PasswordRecoverySessionResponse = z.infer<typeof passwordRecoverySessionResponseSchema>;

export const passwordRecoveryCompleteRequestSchema = z.strictObject({
  password: z.string().min(12).max(256),
});
export type PasswordRecoveryCompleteRequest = z.infer<typeof passwordRecoveryCompleteRequestSchema>;

export const passwordRecoveryRunResponseSchema = z.strictObject({
  outcome: z.enum(["failed", "idle", "sent"]),
});
export type PasswordRecoveryRunResponse = z.infer<typeof passwordRecoveryRunResponseSchema>;

export const securityNotificationHttpRoutes = {
  run: "/internal/security-notifications/run",
} as const;

export const securityNotificationRunResponseSchema = z.strictObject({
  outcome: z.enum(["failed", "idle", "sent", "terminalized"]),
});
export type SecurityNotificationRunResponse = z.infer<typeof securityNotificationRunResponseSchema>;

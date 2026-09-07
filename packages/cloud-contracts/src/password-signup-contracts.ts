import { z } from "zod/v3";

import { accountEmailSchema, passwordLinkRequestSchema } from "./account-contracts.js";
import { passwordSignupOtpSchema } from "./password-signup-confirmation-contracts.js";

export const passwordSignupHttpRoutes = {
  start: "/v1/auth/password/signup/start",
  session: "/v1/auth/password/signup/session",
  verify: "/v1/auth/password/signup/verify",
  resend: "/v1/auth/password/signup/resend",
  complete: "/v1/auth/password/signup/complete",
} as const;

export const passwordSignupStartRequestSchema = z.strictObject({
  claimTicket: z.string().min(32).max(2_048),
  email: accountEmailSchema,
});
export const passwordSignupSessionResponseSchema = z.strictObject({
  csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  email: accountEmailSchema,
  step: z.enum(["verify-email", "set-password"]),
});
export const passwordSignupVerifyRequestSchema = z.strictObject({ token: passwordSignupOtpSchema });
export const passwordSignupResendRequestSchema = z.strictObject({});
export const passwordSignupCompleteRequestSchema = passwordLinkRequestSchema;
export type PasswordSignupSession = z.infer<typeof passwordSignupSessionResponseSchema>;

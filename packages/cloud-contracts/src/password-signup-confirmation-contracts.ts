import { z } from "zod/v3";

import { accountEmailSchema } from "./account-contracts.js";

export const passwordSignupConfirmationHttpRoutes = {
  callback: "/v1/auth/password/callback",
  confirm: "/v1/auth/password/confirm",
} as const;

export const passwordSignupFlowSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const passwordSignupOtpSchema = z.string().regex(/^\d{6}$/u);
export const passwordSignupConfirmQuerySchema = z.strictObject({
  flow: passwordSignupFlowSchema,
});
export const passwordSignupCallbackFormSchema = z.strictObject({
  email: accountEmailSchema,
  flow: passwordSignupFlowSchema,
  token: passwordSignupOtpSchema,
});

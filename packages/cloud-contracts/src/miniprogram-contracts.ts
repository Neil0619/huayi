import { z } from "zod/v3";

import { accountEmailSchema, passwordLoginRequestSchema } from "./account-contracts.js";
import { resourceIdSchema } from "./common-contracts.js";

const proofSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const miniProgramRoutes = {
  login: "/v1/auth/wechat/login",
  onboard: "/v1/auth/wechat/onboard",
  bindingStatus: "/v1/auth/wechat/binding/status",
  approveBinding: "/v1/auth/wechat/binding/approve",
  loginAndLink: "/v1/auth/wechat/binding/login",
  reauthenticate: "/v1/auth/wechat/reauthenticate",
  logout: "/v1/auth/wechat/logout",
  account: "/v1/miniprogram/account",
  downloadExport: "/v1/miniprogram/data-exports/:id/content",
} as const;
export const miniProgramLoginRequestSchema = z.strictObject({
  code: z.string().min(1).max(512),
});
export const miniProgramSessionSchema = z.strictObject({
  state: z.literal("authenticated"),
  token: proofSchema,
  expiresAt: z.string().datetime({ offset: true }),
});
export const miniProgramOnboardingSchema = z.strictObject({
  state: z.literal("onboarding"),
  ticket: proofSchema,
  bindingCode: z.string().regex(/^[A-F0-9]{10}$/u),
  expiresAt: z.string().datetime({ offset: true }),
});
export const miniProgramLoginResponseSchema = z.discriminatedUnion("state", [
  miniProgramSessionSchema,
  miniProgramOnboardingSchema,
]);
export const miniProgramTicketRequestSchema = z.strictObject({ ticket: proofSchema });
export const miniProgramOnboardingRequestSchema = z.strictObject({
  ticket: proofSchema,
  mode: z.enum(["independent", "linked"]),
});
export const miniProgramBindingApprovalSchema = z.strictObject({
  bindingCode: z.string().regex(/^[A-F0-9]{10}$/u),
  confirmed: z.literal(true),
});
export const miniProgramPasswordBindingRequestSchema = z.strictObject({
  ticket: proofSchema,
  email: accountEmailSchema,
  password: passwordLoginRequestSchema.shape.password,
  confirmed: z.literal(true),
});
export const miniProgramBindingStatusSchema = z.strictObject({
  status: z.enum(["pending", "approved", "expired"]),
});
export const miniProgramAccountSchema = z.strictObject({
  id: resourceIdSchema,
  email: accountEmailSchema.nullable(),
  linkedToWeb: z.boolean(),
});
export type MiniProgramLogin = z.infer<typeof miniProgramLoginResponseSchema>;
export type MiniProgramSession = z.infer<typeof miniProgramSessionSchema>;
export type MiniProgramAccount = z.infer<typeof miniProgramAccountSchema>;

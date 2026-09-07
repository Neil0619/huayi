import { accountEmailSchema } from "@huayi/cloud-contracts";
import { z } from "zod/v3";

import type { CloudFoundationDependencies } from "./cloud-foundation-dependencies.js";
import { CloudFault } from "./cloud-fault.js";

const signupStateSchema = z.strictObject({
  kind: z.literal("password-signup-v1"),
  stage: z.enum([
    "pending",
    "verifying",
    "resending",
    "verified",
    "setting-password",
    "password-set",
  ]),
  browserHash: z.string(),
  csrfToken: z.string(),
  claimTicket: z.string(),
  email: accountEmailSchema,
  userId: z.string(),
  authState: z.record(z.string()).optional(),
  passwordHash: z.string().optional(),
  startedAt: z.number().optional(),
});
export type PasswordSignupState = z.infer<typeof signupStateSchema>;

export function signupUnavailable(): CloudFault {
  return new CloudFault("authentication_required", "Registration could not be completed.");
}

export function parsePasswordSignupState(
  dependencies: CloudFoundationDependencies,
  ciphertext: string,
) {
  try {
    const clear = (dependencies.unprotectTransientAuthState ?? dependencies.unprotectRefreshToken)(
      ciphertext,
    );
    return signupStateSchema.parse(JSON.parse(clear));
  } catch {
    throw signupUnavailable();
  }
}

export function protectPasswordSignupState(
  dependencies: CloudFoundationDependencies,
  state: PasswordSignupState,
) {
  return (dependencies.protectTransientAuthState ?? dependencies.protectRefreshToken)(
    JSON.stringify(state),
  );
}

export async function isEmailFirstSignup(
  dependencies: CloudFoundationDependencies,
  flowId: string,
) {
  // Legacy password registrations have no provider state. Any stored state must
  // be readable and belong to this flow before using the email-first path.
  let ciphertext: string;
  try {
    ciphertext = await dependencies.identity.readPasswordSignupState(flowId);
  } catch (error) {
    if (error instanceof CloudFault && error.code === "authentication_required") return false;
    throw error;
  }
  return parsePasswordSignupState(dependencies, ciphertext).kind === "password-signup-v1";
}

import { accountEmailSchema, resourceIdSchema } from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import type { PasswordRecoveryProvider } from "./password-recovery-provider.js";
import { createSupabaseAuthFlow, type SupabaseAuthClientFactory } from "./supabase-auth-flow.js";

function passwordRecoveryFailure(): CloudFault {
  return new CloudFault("authentication_required", "Password recovery could not be completed.");
}

export function createSupabasePasswordRecoveryProvider(
  createAuthClient: SupabaseAuthClientFactory,
): PasswordRecoveryProvider {
  return {
    async begin(command) {
      const flow = createSupabaseAuthFlow();
      try {
        const { error } = await createAuthClient(flow.storage).auth.resetPasswordForEmail(
          command.email,
          { redirectTo: command.redirectTo },
        );
        if (error !== null) throw passwordRecoveryFailure();
        return { authState: {} };
      } catch {
        throw passwordRecoveryFailure();
      }
    },

    async exchange(command) {
      const flow = createSupabaseAuthFlow();
      try {
        const { data, error } = await createAuthClient(flow.storage).auth.verifyOtp({
          token_hash: command.code,
          type: "recovery",
        });
        const email = accountEmailSchema.safeParse(data.user?.email);
        const userId = resourceIdSchema.safeParse(data.user?.id);
        if (error !== null || data.session === null || !email.success || !userId.success) {
          throw passwordRecoveryFailure();
        }
        return {
          authState: flow.state(),
          email: email.data,
          userId: userId.data,
        };
      } catch {
        throw passwordRecoveryFailure();
      }
    },

    async updatePassword(command) {
      const flow = createSupabaseAuthFlow(command.authState);
      try {
        const { data, error } = await createAuthClient(flow.storage).auth.updateUser({
          password: command.password,
        });
        const userId = resourceIdSchema.safeParse(data.user?.id);
        if (error !== null || !userId.success) throw passwordRecoveryFailure();
        return { authState: flow.state(), userId: userId.data };
      } catch {
        throw passwordRecoveryFailure();
      }
    },
  };
}

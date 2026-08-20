import type { SignInMethod } from "@huayi/cloud-contracts";
import type { TransactionSql } from "postgres";

import { CloudFault } from "./cloud-fault.js";
import { hashSecret } from "./security.js";

type TrustedQuery = <T>(operation: (sql: TransactionSql) => Promise<T>) => Promise<T>;

export function createPostgresSignInMethods(options: { pepper: string }, trusted: TrustedQuery) {
  return {
    async authorizeSignInMethod(userId: string, method: SignInMethod) {
      const [result] = await trusted(
        (sql) => sql<{ id: string | null }[]>`
        SELECT authorize_sign_in_method(${userId}, ${method})::text AS id
      `,
      );
      if (result?.id === null || result === undefined) {
        throw new CloudFault("authentication_required", "The sign-in method is not authorized.");
      }
      return { userId };
    },
    async finalizeInvitation(
      claimTicket: string,
      userId: string,
      email: string,
      method: SignInMethod,
    ) {
      const [result] = await trusted(
        (sql) => sql<{ id: string | null }[]>`
        SELECT finalize_invitation(
          ${hashSecret(claimTicket, options.pepper)}, ${userId}, ${email}, 'UTC', 5, ${method}
        )::text AS id
      `,
      );
      if (result?.id === null || result === undefined) {
        throw new CloudFault("invitation_invalid", "Invalid claim.");
      }
      return { userId };
    },
  };
}

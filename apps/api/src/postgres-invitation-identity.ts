import type { TransactionSql } from "postgres";

import { CloudFault } from "./cloud-fault.js";
import { hashSecret } from "./security.js";

export function createPostgresInvitationIdentity(
  pepper: string,
  trusted: <T>(operation: (sql: TransactionSql) => Promise<T>) => Promise<T>,
) {
  return async function bindInvitationIdentity(claimTicket: string, userId: string) {
    const [result] = await trusted(
      (sql) => sql<{ id: string | null }[]>`
        SELECT bind_auth_identity(${hashSecret(claimTicket, pepper)}, ${userId})::text AS id
      `,
    );
    if (result?.id === null || result === undefined) {
      throw new CloudFault("invitation_invalid", "Invalid claim.");
    }
  };
}

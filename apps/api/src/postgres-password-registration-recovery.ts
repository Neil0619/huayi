import type { TransactionSql } from "postgres";

import { CloudFault } from "./cloud-fault.js";
import { hashSecret } from "./security.js";

interface PostgresPasswordRegistrationRecoveryOptions {
  pepper: string;
}

export function createPostgresPasswordRegistrationRecovery(
  options: PostgresPasswordRegistrationRecoveryOptions,
  trusted: <T>(operation: (sql: TransactionSql) => Promise<T>) => Promise<T>,
) {
  return async function resumeInterruptedPasswordRegistration(
    invitationToken: string,
    userId: string,
    email: string,
  ) {
    const [result] = await trusted(
      (sql) => sql<{ id: string | null }[]>`
        SELECT resume_interrupted_password_registration(
          ${hashSecret(invitationToken, options.pepper)},${userId},${email},'UTC',5
        )::text AS id
      `,
    );
    if (result?.id === null || result === undefined) {
      throw new CloudFault("authentication_required", "Registration recovery is unavailable.");
    }
    return { userId };
  };
}

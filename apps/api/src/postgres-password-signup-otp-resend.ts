import type { TransactionSql } from "postgres";

import { CloudFault } from "./cloud-fault.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  type Clock,
  type SecretSource,
} from "./security.js";

interface PostgresPasswordSignupOtpResendOptions {
  clock: Clock;
  pepper: string;
  secrets: SecretSource;
}

export function createPostgresPasswordSignupOtpResend(
  options: PostgresPasswordSignupOtpResendOptions,
  trusted: <T>(operation: (sql: TransactionSql) => Promise<T>) => Promise<T>,
) {
  return async function renewPasswordRegistrationConfirmation(invitationToken: string) {
    const flowId = opaqueSecret(options.secrets);
    const expiresAt = addMilliseconds(options.clock.now(), 15 * 60 * 1_000);
    const [result] = await trusted(
      (sql) => sql<{ account_email: string }[]>`
        SELECT account_email
        FROM renew_interrupted_password_confirmation(
          ${hashSecret(invitationToken, options.pepper)},
          ${hashSecret(flowId, options.pepper)},
          ${expiresAt}
        )
      `,
    );
    if (result === undefined) {
      throw new CloudFault("authentication_required", "Registration confirmation is unavailable.");
    }
    return { email: result.account_email, expiresAt, flowId };
  };
}

import type { TransactionSql } from "postgres";

import { CloudFault } from "./cloud-fault.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  type Clock,
  type SecretSource,
} from "./security.js";

interface WebSessionOptions {
  clock: Clock;
  pepper: string;
  secrets: SecretSource;
}

export function createPostgresWebSession(
  options: WebSessionOptions,
  trusted: <T>(operation: (sql: TransactionSql) => Promise<T>) => Promise<T>,
) {
  return async (userId: string, protectedRefreshToken: string, email?: string) => {
    const sessionId = opaqueSecret(options.secrets);
    const csrfToken = opaqueSecret(options.secrets);
    const expiresAt = addMilliseconds(options.clock.now(), 30 * 24 * 60 * 60 * 1_000);
    const [result] = await trusted(async (sql) => {
      if (email !== undefined) {
        const [profile] = await sql<{ refreshed: boolean }[]>`
          SELECT refresh_profile_email(${userId}, ${email}) AS refreshed
        `;
        if (profile?.refreshed !== true) {
          throw new CloudFault("authentication_required", "The account is not active.");
        }
      }
      return sql<{ access_scope: "data-rights" | "full"; id: string | null }[]>`
      SELECT id::text,access_scope FROM create_web_session(
        ${crypto.randomUUID()}, ${userId}, ${hashSecret(sessionId, options.pepper)},
        ${hashSecret(csrfToken, options.pepper)}, ${protectedRefreshToken}, ${expiresAt}
      )
    `;
    });
    if (result?.id === null || result === undefined) {
      throw new CloudFault("authentication_required", "The account is not active.");
    }
    return {
      access: result.access_scope,
      csrfToken,
      expiresAt,
      sessionId,
      setCookie: `huayi_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`,
    };
  };
}

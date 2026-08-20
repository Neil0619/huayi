import type { TransactionSql } from "postgres";
import type { SignInMethod } from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  secretMatches,
  type Clock,
  type SecretSource,
} from "./security.js";

interface PasswordReauthenticationOptions {
  clock: Clock;
  pepper: string;
  secrets: SecretSource;
  webOrigin: string;
}

export function createPostgresPasswordReauthentication(
  options: PasswordReauthenticationOptions,
  trusted: <T>(operation: (sql: TransactionSql) => Promise<T>) => Promise<T>,
) {
  return {
    async requireRecentAuthentication(sessionId: string, method: SignInMethod) {
      const [result] = await trusted(
        (sql) => sql<{ user_id: string | null }[]>`
          SELECT require_recent_authentication(
            ${hashSecret(sessionId, options.pepper)}, ${method}
          )::text AS user_id
        `,
      );
      if (result?.user_id === null || result === undefined) {
        throw new CloudFault("authentication_required", "Recent authentication is required.");
      }
      return { userId: result.user_id };
    },

    async preparePasswordReauthentication(sessionId: string, origin: string, csrfToken: string) {
      const [session] = await trusted(
        (sql) => sql<{ csrf_hash: string; email: string; user_id: string }[]>`
          SELECT user_id::text,email,csrf_hash
          FROM prepare_password_reauthentication(${hashSecret(sessionId, options.pepper)})
        `,
      );
      if (session === undefined) {
        throw new CloudFault("authentication_required", "Password authentication is unavailable.");
      }
      if (
        origin !== options.webOrigin ||
        !secretMatches(csrfToken, session.csrf_hash, options.pepper)
      ) {
        throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
      }
      return { email: session.email, userId: session.user_id };
    },

    async completePasswordReauthentication(
      sessionId: string,
      providerUserId: string,
      refreshCiphertext: string,
    ) {
      const newSessionId = opaqueSecret(options.secrets);
      const csrfToken = opaqueSecret(options.secrets);
      const expiresAt = addMilliseconds(options.clock.now(), 30 * 24 * 60 * 60 * 1_000);
      const [session] = await trusted(
        (sql) => sql<{ access_scope: "full"; id: string }[]>`
          SELECT id::text,access_scope FROM rotate_password_reauthenticated_session(
            ${hashSecret(sessionId, options.pepper)}, ${providerUserId}, ${crypto.randomUUID()},
            ${hashSecret(newSessionId, options.pepper)},
            ${hashSecret(csrfToken, options.pepper)}, ${refreshCiphertext}, ${expiresAt}
          )
        `,
      );
      if (session === undefined) {
        throw new CloudFault("authentication_required", "Password authentication did not match.");
      }
      return {
        access: session.access_scope,
        csrfToken,
        expiresAt,
        sessionId: newSessionId,
        setCookie: `huayi_session=${newSessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`,
      };
    },
  };
}

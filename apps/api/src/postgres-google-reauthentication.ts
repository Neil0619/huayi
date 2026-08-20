import type { TransactionSql } from "postgres";

import { CloudFault } from "./cloud-fault.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  type Clock,
  type SecretSource,
} from "./security.js";

interface GoogleReauthenticationOptions {
  clock: Clock;
  pepper: string;
  secrets: SecretSource;
  webOrigin: string;
}

export function createPostgresGoogleReauthentication(
  options: GoogleReauthenticationOptions,
  trusted: <T>(operation: (sql: TransactionSql) => Promise<T>) => Promise<T>,
) {
  return {
    async createGoogleReauthentication(sessionId: string, origin: string, csrfToken: string) {
      if (origin !== options.webOrigin) {
        throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
      }
      const flowId = opaqueSecret(options.secrets);
      const expiresAt = addMilliseconds(options.clock.now(), 15 * 60 * 1_000);
      const [result] = await trusted(
        (sql) => sql<{ user_id: string | null }[]>`
          SELECT create_google_reauthentication(
            ${hashSecret(flowId, options.pepper)}, ${hashSecret(sessionId, options.pepper)},
            ${hashSecret(csrfToken, options.pepper)}, ${expiresAt}
          )::text AS user_id
        `,
      );
      if (result?.user_id === null || result === undefined) {
        throw new CloudFault("authentication_required", "Google authentication is unavailable.");
      }
      return { expiresAt, flowId };
    },

    async continueGoogleReauthentication(flowId: string, sessionId: string) {
      const [result] = await trusted(
        (sql) => sql<{ user_id: string | null }[]>`
          SELECT continue_google_reauthentication(
            ${hashSecret(flowId, options.pepper)}, ${hashSecret(sessionId, options.pepper)}
          )::text AS user_id
        `,
      );
      if (result?.user_id === null || result === undefined) {
        throw new CloudFault("authentication_required", "Google authentication is unavailable.");
      }
    },

    async completeGoogleReauthentication(
      flowId: string,
      sessionId: string,
      providerUserId: string,
      refreshCiphertext: string,
    ) {
      const newSessionId = opaqueSecret(options.secrets);
      const csrfToken = opaqueSecret(options.secrets);
      const expiresAt = addMilliseconds(options.clock.now(), 30 * 24 * 60 * 60 * 1_000);
      const [session] = await trusted(
        (sql) => sql<{ access_scope: "full"; id: string }[]>`
          SELECT id::text,access_scope FROM complete_google_reauthentication(
            ${hashSecret(flowId, options.pepper)}, ${hashSecret(sessionId, options.pepper)},
            ${providerUserId}, ${crypto.randomUUID()}, ${hashSecret(newSessionId, options.pepper)},
            ${hashSecret(csrfToken, options.pepper)}, ${refreshCiphertext}, ${expiresAt}
          )
        `,
      );
      if (session === undefined) {
        throw new CloudFault("authentication_required", "Google authentication did not match.");
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

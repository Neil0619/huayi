import type { TransactionSql } from "postgres";

import { CloudFault } from "./cloud-fault.js";
import type { GoogleLinkRepository } from "./google-link-module.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  type Clock,
  type SecretSource,
} from "./security.js";

interface GoogleLinkOptions {
  clock: Clock;
  pepper: string;
  secrets: SecretSource;
  webOrigin: string;
}

type TrustedQuery = <Value>(operation: (sql: TransactionSql) => Promise<Value>) => Promise<Value>;

export function createPostgresGoogleLink(
  options: GoogleLinkOptions,
  trusted: TrustedQuery,
): GoogleLinkRepository {
  return {
    async claimContinuation(flowId, sessionId) {
      const leaseId = opaqueSecret(options.secrets);
      const leaseExpiresAt = addMilliseconds(options.clock.now(), 30_000);
      const [result] = await trusted(
        (sql) => sql<
          {
            provider_state_ciphertext: string | null;
            refresh_ciphertext: string | null;
            stage: "claimed" | "refreshed";
            user_id: string;
          }[]
        >`
          SELECT user_id::text,stage,refresh_ciphertext,provider_state_ciphertext
          FROM claim_google_link_continuation(
            ${hashSecret(flowId, options.pepper)},${hashSecret(sessionId, options.pepper)},
            ${hashSecret(leaseId, options.pepper)},${leaseExpiresAt}
          )
        `,
      );
      if (result?.stage === "claimed" && result.refresh_ciphertext !== null) {
        return {
          leaseId,
          refreshCiphertext: result.refresh_ciphertext,
          stage: "claimed",
          userId: result.user_id,
        };
      }
      if (result?.stage === "refreshed" && result.provider_state_ciphertext !== null) {
        return {
          leaseId,
          protectedProviderState: result.provider_state_ciphertext,
          stage: "refreshed",
          userId: result.user_id,
        };
      }
      throw new CloudFault("authentication_required", "Google link is unavailable.");
    },

    async complete(flowId, sessionId, providerUserId, refreshCiphertext) {
      const newSessionId = opaqueSecret(options.secrets);
      const csrfToken = opaqueSecret(options.secrets);
      const expiresAt = addMilliseconds(options.clock.now(), 30 * 24 * 60 * 60 * 1_000);
      const [session] = await trusted(
        (sql) => sql<{ access_scope: "full"; id: string }[]>`
          SELECT id::text,access_scope FROM complete_google_link(
            ${hashSecret(flowId, options.pepper)},${hashSecret(sessionId, options.pepper)},
            ${providerUserId},${crypto.randomUUID()},${hashSecret(newSessionId, options.pepper)},
            ${hashSecret(csrfToken, options.pepper)},${refreshCiphertext},${expiresAt}
          )
        `,
      );
      if (session === undefined) {
        throw new CloudFault("authentication_required", "Google link did not match.");
      }
      return {
        access: session.access_scope,
        csrfToken,
        expiresAt,
        sessionId: newSessionId,
        setCookie: `huayi_session=${newSessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`,
      };
    },

    async create(sessionId, origin, csrfToken) {
      if (origin !== options.webOrigin) {
        throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
      }
      const flowId = opaqueSecret(options.secrets);
      const expiresAt = addMilliseconds(options.clock.now(), 15 * 60 * 1_000);
      const [result] = await trusted(
        (sql) => sql<{ status: "already-linked" | "created"; user_id: string | null }[]>`
          SELECT user_id::text,status FROM create_google_link(
            ${hashSecret(flowId, options.pepper)},${hashSecret(sessionId, options.pepper)},
            ${hashSecret(csrfToken, options.pepper)},${expiresAt}
          )
        `,
      );
      if (result?.status === "already-linked") {
        throw new CloudFault("sign_in_method_already_linked", "Google is already linked.");
      }
      if (result?.user_id === null || result === undefined) {
        throw new CloudFault("authentication_required", "Google link is unavailable.");
      }
      return { expiresAt, flowId };
    },

    async readProviderState(flowId, sessionId) {
      const [result] = await trusted(
        (sql) => sql<{ state: string | null }[]>`
          SELECT read_google_link_state(
            ${hashSecret(flowId, options.pepper)},${hashSecret(sessionId, options.pepper)}
          ) AS state
        `,
      );
      if (result?.state === null || result === undefined) {
        throw new CloudFault("authentication_required", "Google link is unavailable.");
      }
      return result.state;
    },

    async saveProviderStarted(flowId, sessionId, leaseId, protectedProviderState) {
      const [result] = await trusted(
        (sql) => sql<{ saved: boolean | null }[]>`
          SELECT save_google_link_provider_started(
            ${hashSecret(flowId, options.pepper)},${hashSecret(sessionId, options.pepper)},
            ${hashSecret(leaseId, options.pepper)},${protectedProviderState}
          ) AS saved
        `,
      );
      if (result?.saved !== true) {
        throw new CloudFault("authentication_required", "Google link lease is unavailable.");
      }
    },

    async saveRefreshed(
      flowId,
      sessionId,
      leaseId,
      userId,
      refreshCiphertext,
      protectedProviderState,
    ) {
      const [result] = await trusted(
        (sql) => sql<{ saved: boolean | null }[]>`
          SELECT save_google_link_refresh(
            ${hashSecret(flowId, options.pepper)},${hashSecret(sessionId, options.pepper)},
            ${hashSecret(leaseId, options.pepper)},${userId},${refreshCiphertext},
            ${protectedProviderState}
          ) AS saved
        `,
      );
      if (result?.saved !== true) {
        throw new CloudFault("authentication_required", "Google link refresh did not match.");
      }
    },
  };
}

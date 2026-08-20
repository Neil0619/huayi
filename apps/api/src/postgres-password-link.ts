import type { TransactionSql } from "postgres";
import type { SignInMethod } from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import type { PasswordLinkRepository } from "./password-link-module.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  type Clock,
  type SecretSource,
} from "./security.js";

interface PasswordLinkOptions {
  clock: Clock;
  pepper: string;
  secrets: SecretSource;
  webOrigin: string;
}

type TrustedQuery = <Value>(operation: (sql: TransactionSql) => Promise<Value>) => Promise<Value>;

export function createPostgresPasswordLink(
  options: PasswordLinkOptions,
  trusted: TrustedQuery,
): PasswordLinkRepository {
  return {
    async claim(sessionId, origin, csrfToken) {
      if (origin !== options.webOrigin) {
        throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
      }
      const leaseId = opaqueSecret(options.secrets);
      const leaseExpiresAt = addMilliseconds(options.clock.now(), 30_000);
      const flowExpiresAt = addMilliseconds(options.clock.now(), 15 * 60 * 1_000);
      const [result] = await trusted(
        (sql) => sql<
          {
            flow_hash: string;
            provider_state_ciphertext: string | null;
            refresh_ciphertext: string | null;
            stage: "already-linked" | "claimed" | "provider-updated" | "refreshed";
            user_id: string;
          }[]
        >`
          SELECT flow_hash,user_id::text,stage,refresh_ciphertext,provider_state_ciphertext
          FROM claim_password_link(
            ${hashSecret(sessionId, options.pepper)},${hashSecret(csrfToken, options.pepper)},
            ${hashSecret(opaqueSecret(options.secrets), options.pepper)},
            ${hashSecret(leaseId, options.pepper)},${leaseExpiresAt},${flowExpiresAt}
          )
        `,
      );
      if (result?.stage === "already-linked") {
        throw new CloudFault("sign_in_method_already_linked", "Password is already linked.");
      }
      if (result?.stage === "claimed" && result.refresh_ciphertext !== null) {
        return {
          flowKey: result.flow_hash,
          leaseId,
          refreshCiphertext: result.refresh_ciphertext,
          stage: "claimed",
          userId: result.user_id,
        };
      }
      if (result?.stage === "refreshed" && result.provider_state_ciphertext !== null) {
        return {
          flowKey: result.flow_hash,
          leaseId,
          protectedProviderState: result.provider_state_ciphertext,
          stage: "refreshed",
          userId: result.user_id,
        };
      }
      if (result?.stage === "provider-updated") {
        return {
          flowKey: result.flow_hash,
          leaseId,
          stage: "provider-updated",
          userId: result.user_id,
        };
      }
      throw new CloudFault("authentication_required", "Password link is unavailable.");
    },

    async complete(flowKey, sessionId, leaseId) {
      const newSessionId = opaqueSecret(options.secrets);
      const csrfToken = opaqueSecret(options.secrets);
      const expiresAt = addMilliseconds(options.clock.now(), 30 * 24 * 60 * 60 * 1_000);
      const [result] = await trusted(
        (sql) => sql<
          {
            access_scope: "full";
            id: string;
            methods: { linkedAt: string; method: SignInMethod }[];
          }[]
        >`
          SELECT id::text,access_scope,methods FROM complete_password_link(
            ${flowKey},${hashSecret(sessionId, options.pepper)},
            ${hashSecret(leaseId, options.pepper)},${crypto.randomUUID()},
            ${hashSecret(newSessionId, options.pepper)},${hashSecret(csrfToken, options.pepper)},
            ${expiresAt}
          )
        `,
      );
      if (result === undefined) {
        throw new CloudFault("authentication_required", "Password link is unavailable.");
      }
      return {
        methods: result.methods.map((method) => ({
          linkedAt: new Date(method.linkedAt),
          method: method.method,
        })),
        session: {
          access: result.access_scope,
          csrfToken,
          expiresAt,
          sessionId: newSessionId,
          setCookie: `huayi_session=${newSessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`,
        },
      };
    },

    async saveProviderUpdated(flowKey, sessionId, leaseId, providerUserId) {
      const [result] = await trusted(
        (sql) => sql<{ saved: boolean | null }[]>`
          SELECT save_password_link_provider_updated(
            ${flowKey},${hashSecret(sessionId, options.pepper)},
            ${hashSecret(leaseId, options.pepper)},${providerUserId}
          ) AS saved
        `,
      );
      if (result?.saved !== true) {
        throw new CloudFault("authentication_required", "Password link did not match.");
      }
    },

    async saveRefreshed(
      flowKey,
      sessionId,
      leaseId,
      providerUserId,
      refreshCiphertext,
      protectedProviderState,
    ) {
      const [result] = await trusted(
        (sql) => sql<{ saved: boolean | null }[]>`
          SELECT save_password_link_refresh(
            ${flowKey},${hashSecret(sessionId, options.pepper)},
            ${hashSecret(leaseId, options.pepper)},${providerUserId},${refreshCiphertext},
            ${protectedProviderState}
          ) AS saved
        `,
      );
      if (result?.saved !== true) {
        throw new CloudFault("authentication_required", "Password link refresh did not match.");
      }
    },
  };
}

import { CloudFault } from "./cloud-fault.js";
import type { AnalysisDatabase } from "./analysis-database.js";
import type {
  PasswordRecoveryCompletion,
  PasswordRecoveryRepository,
} from "./password-recovery-module.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  type Clock,
  type SecretSource,
} from "./security.js";

interface PostgresPasswordRecoveryOptions {
  clock: Clock;
  database: AnalysisDatabase;
  pepper: string;
  protectFlowSecret(value: string): string;
  secrets: SecretSource;
  unprotectFlowSecret(value: string): string;
  webOrigin: string;
}

function unavailable(): CloudFault {
  return new CloudFault("authentication_required", "Password recovery is unavailable.");
}

function requireSaved(value: boolean | null | undefined): void {
  if (value !== true) throw unavailable();
}

export function createPostgresPasswordRecovery(options: PostgresPasswordRecoveryOptions) {
  const repository: PasswordRecoveryRepository & { cleanup(limit?: number): Promise<number> } = {
    async callback(flowId, providerUserId, providerEmail, protectedProviderState) {
      const recoverySessionId = opaqueSecret(options.secrets);
      const csrfToken = opaqueSecret(options.secrets);
      const expiresAt = addMilliseconds(options.clock.now(), 15 * 60_000);
      const [result] = await options.database.trusted((trusted) =>
        trusted.rows<{ saved: boolean | null }>(
          `SELECT complete_password_recovery_callback(
            $1,$2,$3,$4,$5,$6,$7,$8
          ) AS saved`,
          [
            hashSecret(flowId, options.pepper),
            providerUserId,
            providerEmail,
            protectedProviderState,
            hashSecret(recoverySessionId, options.pepper),
            hashSecret(csrfToken, options.pepper),
            expiresAt,
            options.clock.now(),
          ],
        ),
      );
      requireSaved(result?.saved);
      return { csrfToken, expiresAt, recoverySessionId };
    },

    async claimCompletion(recoverySessionId, origin, csrfToken) {
      if (origin !== options.webOrigin) {
        throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
      }
      const leaseId = opaqueSecret(options.secrets);
      const leaseExpiresAt = addMilliseconds(options.clock.now(), 30_000);
      const [result] = await options.database.trusted((trusted) =>
        trusted.rows<{
          callback_flow_ciphertext: string;
          flow_hash: string;
          provider_state_ciphertext: string | null;
          stage: "provider-updated" | "verified";
        }>(
          `SELECT flow_hash,stage,provider_state_ciphertext,callback_flow_ciphertext
           FROM claim_password_recovery_completion($1,$2,$3,$4,$5)`,
          [
            hashSecret(recoverySessionId, options.pepper),
            hashSecret(csrfToken, options.pepper),
            hashSecret(leaseId, options.pepper),
            leaseExpiresAt,
            options.clock.now(),
          ],
        ),
      );
      if (result === undefined) throw unavailable();
      const flowId = options.unprotectFlowSecret(result.callback_flow_ciphertext);
      if (result.stage === "provider-updated") {
        return { flowId, leaseId, stage: result.stage } satisfies PasswordRecoveryCompletion;
      }
      if (result.provider_state_ciphertext === null) throw unavailable();
      return {
        flowId,
        leaseId,
        protectedProviderState: result.provider_state_ciphertext,
        stage: result.stage,
      } satisfies PasswordRecoveryCompletion;
    },

    async claimDispatch() {
      const leaseId = opaqueSecret(options.secrets);
      const leaseExpiresAt = addMilliseconds(options.clock.now(), 60_000);
      const [result] = await options.database.trusted((trusted) =>
        trusted.rows<{
          callback_flow_ciphertext: string;
          email: string;
          flow_hash: string;
        }>(
          `SELECT flow_hash,email,callback_flow_ciphertext
           FROM claim_password_recovery_dispatch($1,$2,$3)`,
          [hashSecret(leaseId, options.pepper), leaseExpiresAt, options.clock.now()],
        ),
      );
      if (result === undefined) return undefined;
      return {
        email: result.email,
        flowId: options.unprotectFlowSecret(result.callback_flow_ciphertext),
        leaseId,
      };
    },

    async cleanup(limit = 100) {
      const [result] = await options.database.trusted((trusted) =>
        trusted.rows<{ count: number }>("SELECT cleanup_password_recovery_flows($1,$2) AS count", [
          limit,
          options.clock.now(),
        ]),
      );
      return result?.count ?? 0;
    },

    async complete(flowId, leaseId) {
      const [result] = await options.database.trusted((trusted) =>
        trusted.rows<{ saved: boolean | null }>(
          "SELECT complete_password_recovery($1,$2,$3,$4) AS saved",
          [
            hashSecret(flowId, options.pepper),
            hashSecret(leaseId, options.pepper),
            crypto.randomUUID(),
            options.clock.now(),
          ],
        ),
      );
      requireSaved(result?.saved);
    },

    async failDispatch(flowId, leaseId) {
      const [result] = await options.database.trusted((trusted) =>
        trusted.rows<{ saved: boolean | null }>(
          "SELECT fail_password_recovery_dispatch($1,$2,$3) AS saved",
          [
            hashSecret(flowId, options.pepper),
            hashSecret(leaseId, options.pepper),
            options.clock.now(),
          ],
        ),
      );
      requireSaved(result?.saved);
    },

    async markDispatched(flowId, leaseId) {
      const [result] = await options.database.trusted((trusted) =>
        trusted.rows<{ saved: boolean | null }>(
          "SELECT mark_password_recovery_dispatched($1,$2,$3) AS saved",
          [
            hashSecret(flowId, options.pepper),
            hashSecret(leaseId, options.pepper),
            options.clock.now(),
          ],
        ),
      );
      requireSaved(result?.saved);
    },

    async readProviderState(flowId) {
      const [result] = await options.database.trusted((trusted) =>
        trusted.rows<{ provider_state: string | null }>(
          "SELECT read_password_recovery_state($1,$2) AS provider_state",
          [hashSecret(flowId, options.pepper), options.clock.now()],
        ),
      );
      if (result?.provider_state === null || result?.provider_state === undefined) {
        throw unavailable();
      }
      return result.provider_state;
    },

    async readSession(recoverySessionId, origin) {
      if (origin !== options.webOrigin) {
        throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
      }
      const csrfToken = opaqueSecret(options.secrets);
      const [result] = await options.database.trusted((trusted) =>
        trusted.rows<{ expires_at: Date | string }>(
          "SELECT expires_at FROM read_password_recovery_session($1,$2,$3)",
          [
            hashSecret(recoverySessionId, options.pepper),
            hashSecret(csrfToken, options.pepper),
            options.clock.now(),
          ],
        ),
      );
      if (result === undefined) throw unavailable();
      return { csrfToken, expiresAt: new Date(result.expires_at) };
    },

    async request({ email }) {
      const flowId = opaqueSecret(options.secrets);
      await options.database.trusted((trusted) =>
        trusted.rows<{ created: boolean }>(
          "SELECT request_password_recovery($1,$2,$3,$4,$5) AS created",
          [
            email,
            hashSecret(flowId, options.pepper),
            options.protectFlowSecret(flowId),
            addMilliseconds(options.clock.now(), 30 * 60_000),
            options.clock.now(),
          ],
        ),
      );
    },

    async saveProviderUpdated(flowId, leaseId, providerUserId, protectedProviderState) {
      const [result] = await options.database.trusted((trusted) =>
        trusted.rows<{ saved: boolean | null }>(
          "SELECT save_password_recovery_provider_updated($1,$2,$3,$4,$5) AS saved",
          [
            hashSecret(flowId, options.pepper),
            hashSecret(leaseId, options.pepper),
            providerUserId,
            protectedProviderState,
            options.clock.now(),
          ],
        ),
      );
      requireSaved(result?.saved);
    },

    async saveSent(flowId, leaseId, protectedProviderState) {
      const [result] = await options.database.trusted((trusted) =>
        trusted.rows<{ saved: boolean | null }>(
          "SELECT save_password_recovery_sent($1,$2,$3,$4) AS saved",
          [
            hashSecret(flowId, options.pepper),
            hashSecret(leaseId, options.pepper),
            protectedProviderState,
            options.clock.now(),
          ],
        ),
      );
      requireSaved(result?.saved);
    },
  };
  return repository;
}

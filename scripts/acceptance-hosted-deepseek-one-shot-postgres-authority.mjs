import { createHash, randomBytes, randomUUID } from "node:crypto";

export {
  createHostedAcceptanceHmacKeyring,
  hostedAcceptanceHmacContext,
} from "./acceptance-hosted-deepseek-one-shot-hmac.mjs";

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const verifierPattern = /^[0-9a-f]{64}$/u;
const failureMessage = "Hosted acceptance HMAC recovery failed closed.";

function failedClosed() {
  return new Error(failureMessage);
}

function stableDigest(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function token(randomBytes_) {
  const value = randomBytes_(32);
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) throw failedClosed();
  return Buffer.from(value).toString("base64url");
}

function oneRow(result) {
  if (!Array.isArray(result?.rows) || result.rows.length !== 1) throw failedClosed();
  return result.rows[0];
}

function timestamp(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw failedClosed();
}

export function createHostedDeepSeekPostgresAuthority({
  keyring,
  query,
  randomBytes_ = randomBytes,
  randomUUID_ = randomUUID,
} = {}) {
  if (
    typeof query !== "function" ||
    typeof keyring?.create !== "function" ||
    typeof keyring?.recover !== "function" ||
    typeof randomBytes_ !== "function" ||
    typeof randomUUID_ !== "function"
  ) {
    throw failedClosed();
  }

  return Object.freeze({
    async armCleanup(command) {
      const cleanupToken = command.claimToken;
      const row = oneRow(
        await query(
          `SELECT
             operation_id::text AS "operationId",
             claim_generation::integer AS "claimGeneration",
             armed_at AS "armedAt",
             claim_expires_at AS "leaseExpiresAt"
           FROM huayi_private.arm_hosted_acceptance_cleanup($1,$2,$3,$4)`,
          [command.operationId, command.leaseGeneration, command.claimToken, cleanupToken],
        ),
      );
      return Object.freeze({
        armedAt: timestamp(row.armedAt),
        claimGeneration: row.claimGeneration,
        cleanupToken,
        deployments: command.deployments,
        desiredKillSwitchEnabled: command.desiredKillSwitchEnabled,
        leaseExpiresAt: timestamp(row.leaseExpiresAt),
        operationId: row.operationId,
      });
    },
    async bindRequest(command) {
      const suppliedVerifier = Object.hasOwn(command, "idempotencyVerifier");
      if (suppliedVerifier && !verifierPattern.test(command.idempotencyVerifier ?? "")) {
        throw failedClosed();
      }
      const verifier = suppliedVerifier
        ? command.idempotencyVerifier
        : keyring.create(command.operationId).verifier;
      const row = oneRow(
        await query(
          `SELECT huayi_private.bind_hosted_acceptance_request(
             $1,$2,$3,$4,$5,$6,$7
           )::text AS "requestId"`,
          [
            command.operationId,
            command.leaseGeneration,
            command.claimToken,
            command.ownerId,
            command.requestId,
            command.idempotencyKey,
            verifier,
          ],
        ),
      );
      return Object.freeze({
        idempotencyKey: command.idempotencyKey,
        operationId: command.operationId,
        ownerId: command.ownerId,
        requestId: row.requestId,
        status: "bound",
      });
    },
    async claimCleanup() {
      const cleanupToken = token(randomBytes_);
      const claimToken = token(randomBytes_);
      const row = oneRow(
        await query(
          `SELECT
             operation_id::text AS "operationId",
             cleanup_claim_generation::integer AS "claimGeneration",
             cleanup_claim_expires_at AS "cleanupLeaseExpiresAt",
             cleanup_already_completed AS "cleanupAlreadyCompleted",
             armed_at AS "armedAt",
             operation_state AS "operationState",
             operation_lease_generation::integer AS "operationLeaseGeneration",
             operation_lease_expires_at AS "operationLeaseExpiresAt",
             candidate_commit AS "candidateCommit",
             maximum_reservation_micro_usd::integer AS "maximumReservationMicroUsd",
             owner_user_id::text AS "ownerId",
             payload_digest AS "payloadDigest",
             idempotency_key_hmac AS "idempotencyVerifier",
             idempotency_hmac_context AS "idempotencyContext",
             idempotency_hmac_version::integer AS "idempotencyVersion",
             operation_created_at AS "operationCreatedAt",
             dispatch_attempted AS "dispatchAttempted",
             settlement_recorded AS "settlementRecorded",
             server_request_id::text AS "requestId",
             api_deployment_id AS "apiDeploymentId",
             api_source_commit AS "apiCommit",
             web_deployment_id AS "webDeploymentId",
             web_source_commit AS "webCommit"
           FROM huayi_private.claim_hosted_acceptance_cleanup($1,$2)`,
          [cleanupToken, claimToken],
        ),
      );
      const deployments = Object.freeze({
        api: Object.freeze({
          commit: row.apiCommit,
          deploymentId: row.apiDeploymentId,
          state: "READY",
        }),
        web: Object.freeze({
          commit: row.webCommit,
          deploymentId: row.webDeploymentId,
          state: "READY",
        }),
      });
      const cleanupLease = Object.freeze({
        armedAt: timestamp(row.armedAt),
        claimGeneration: row.claimGeneration,
        cleanupToken,
        deployments,
        desiredKillSwitchEnabled: true,
        leaseExpiresAt: timestamp(row.cleanupLeaseExpiresAt),
        operationId: row.operationId,
      });
      if (row.operationState !== "running") return cleanupLease;
      const material = keyring.recover({
        context: row.idempotencyContext,
        operationId: row.operationId,
        verifier: row.idempotencyVerifier,
        version: row.idempotencyVersion,
      });
      return Object.freeze({
        cleanupAlreadyCompleted: row.cleanupAlreadyCompleted,
        cleanupLease,
        dispatchRecovery: Object.freeze({
          dispatchAttempted: row.dispatchAttempted,
          idempotencyKey: material.idempotencyKey,
          idempotencyVerifier: material.verifier,
          operationLease: Object.freeze({
            candidateCommit: row.candidateCommit,
            claimToken,
            idempotencyKey: material.idempotencyKey,
            leaseExpiresAt: timestamp(row.operationLeaseExpiresAt),
            leaseGeneration: row.operationLeaseGeneration,
            maximumReservationMicroUsd: row.maximumReservationMicroUsd,
            operationId: row.operationId,
            ownerId: row.ownerId,
          }),
          observedAt: timestamp(row.operationCreatedAt),
          payloadDigest: row.payloadDigest,
          requestId: row.requestId ?? null,
          settlementRecorded: row.settlementRecorded,
        }),
      });
    },
    async claimOperation(command) {
      const operationId = randomUUID_();
      if (!operationIdPattern.test(operationId)) throw failedClosed();
      const material = keyring.create(operationId);
      const claimToken = token(randomBytes_);
      const row = oneRow(
        await query(
          `SELECT
             operation_id::text AS "operationId",
             owner_user_id::text AS "ownerId",
             lease_generation::integer AS "leaseGeneration",
             lease_expires_at AS "leaseExpiresAt"
           FROM huayi_private.claim_hosted_acceptance_operation(
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
           )`,
          [
            operationId,
            stableDigest(command),
            command.candidateCommit,
            command.maximumReservationMicroUsd,
            command.payloadDigest,
            command.deployments.api.deploymentId,
            command.deployments.api.commit,
            command.deployments.web.deploymentId,
            command.deployments.web.commit,
            material.verifier,
            material.version,
            claimToken,
          ],
        ),
      );
      return Object.freeze({
        candidateCommit: command.candidateCommit,
        claimToken,
        idempotencyKey: material.idempotencyKey,
        leaseExpiresAt: timestamp(row.leaseExpiresAt),
        leaseGeneration: row.leaseGeneration,
        maximumReservationMicroUsd: command.maximumReservationMicroUsd,
        operationId: row.operationId,
        ownerId: row.ownerId,
      });
    },
    async completeCleanup(command) {
      const row = oneRow(
        await query(
          `SELECT huayi_private.complete_hosted_acceptance_cleanup(
             $1,$2,$3,$4
           ) AS "operationState"`,
          [command.operationId, command.claimGeneration, command.cleanupToken, command.observedAt],
        ),
      );
      return Object.freeze({
        operationId: command.operationId,
        operationState: row.operationState,
        status: "completed",
      });
    },
    async completeOperation(command) {
      const safeErrorCode = command.outcome === "accepted" ? null : "internal_safe_failure";
      const row = oneRow(
        await query(
          `SELECT huayi_private.complete_hosted_acceptance_operation(
             $1,$2,$3,$4,$5
           ) AS outcome`,
          [
            command.operationId,
            command.leaseGeneration,
            command.claimToken,
            command.outcome,
            safeErrorCode,
          ],
        ),
      );
      return Object.freeze({
        operationId: command.operationId,
        outcome: row.outcome,
        status: "completed",
      });
    },
    async markDispatchAttempted(command) {
      const row = oneRow(
        await query(
          `SELECT huayi_private.mark_hosted_acceptance_dispatch(
             $1,$2,$3,$4
           )::text AS "operationId"`,
          [command.operationId, command.leaseGeneration, command.claimToken, command.payloadDigest],
        ),
      );
      return Object.freeze({ operationId: row.operationId, status: "dispatch-attempted" });
    },
    async readStatus() {
      const row = oneRow(
        await query(`SELECT huayi_private.read_hosted_acceptance_status() AS state`, []),
      );
      return Object.freeze({
        authority: "hosted-deepseek-one-shot",
        records: row.state === "absent" ? [] : [Object.freeze({ state: row.state })],
      });
    },
    async recordSettlement(command) {
      const receiptDigest = stableDigest(command.settlement);
      const row = oneRow(
        await query(
          `SELECT huayi_private.record_hosted_acceptance_settlement(
             $1,$2,$3,$4,$5
           )::text AS "requestId"`,
          [
            command.operationId,
            command.leaseGeneration,
            command.claimToken,
            command.requestId,
            receiptDigest,
          ],
        ),
      );
      return Object.freeze({
        operationId: command.operationId,
        requestId: row.requestId,
        status: "recorded",
      });
    },
    async retain(maximumRows = 100) {
      return oneRow(
        await query(
          `SELECT
             scrubbed_count::integer AS "scrubbedCount",
             deleted_count::integer AS "deletedCount"
           FROM huayi_private.retain_hosted_acceptance_evidence($1)`,
          [maximumRows],
        ),
      );
    },
  });
}

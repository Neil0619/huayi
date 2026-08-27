import {
  hasExactKeys,
  operationLeaseIsValid,
  parseUtcTimestamp,
} from "./acceptance-hosted-deepseek-one-shot-contract.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function dispatchRecoveryIsValid(recovery, requiredUntilMilliseconds) {
  return (
    hasExactKeys(recovery, [
      "dispatchAttempted",
      "idempotencyKey",
      "idempotencyVerifier",
      "observedAt",
      "operationLease",
      "payloadDigest",
      "requestId",
      "settlementRecorded",
    ]) &&
    typeof recovery.dispatchAttempted === "boolean" &&
    typeof recovery.idempotencyKey === "string" &&
    /^[A-Za-z0-9._:-]{8,128}$/u.test(recovery.idempotencyKey) &&
    typeof recovery.idempotencyVerifier === "string" &&
    /^[0-9a-f]{64}$/u.test(recovery.idempotencyVerifier) &&
    typeof recovery.payloadDigest === "string" &&
    /^[0-9a-f]{64}$/u.test(recovery.payloadDigest) &&
    parseUtcTimestamp(recovery.observedAt) !== null &&
    (recovery.requestId === null || uuidPattern.test(recovery.requestId)) &&
    (recovery.dispatchAttempted || recovery.requestId === null) &&
    typeof recovery.settlementRecorded === "boolean" &&
    (!recovery.settlementRecorded || recovery.requestId !== null) &&
    hasExactKeys(recovery.operationLease, [
      "candidateCommit",
      "claimToken",
      "idempotencyKey",
      "leaseExpiresAt",
      "leaseGeneration",
      "maximumReservationMicroUsd",
      "operationId",
      "ownerId",
    ]) &&
    recovery.operationLease.idempotencyKey === recovery.idempotencyKey &&
    operationLeaseIsValid(
      recovery.operationLease,
      {
        candidateCommit: recovery.operationLease.candidateCommit,
        maximumReservationMicroUsd: recovery.operationLease.maximumReservationMicroUsd,
      },
      requiredUntilMilliseconds,
    )
  );
}

import {
  deploymentsAreValid,
  hasExactKeys,
  isSafeNonnegativeInteger,
  parseUtcTimestamp,
} from "./acceptance-hosted-deepseek-one-shot-contract.mjs";

const failureMessage = "Hosted settlement evidence failed closed.";
const digestPattern = /^[0-9a-f]{64}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const tokenPattern = /^[A-Za-z0-9_-]{8,128}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function failedClosed() {
  return new Error(failureMessage);
}

function isUuid(value) {
  return typeof value === "string" && uuidPattern.test(value);
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function oneRow(result) {
  if (!Array.isArray(result?.rows) || result.rows.length !== 1) throw failedClosed();
  return result.rows[0];
}

function reconciliationCommandIsValid(command) {
  return (
    hasExactKeys(command, [
      "claimToken",
      "idempotencyKey",
      "leaseGeneration",
      "operationId",
      "ownerId",
      "payloadDigest",
    ]) &&
    isUuid(command.operationId) &&
    isPositiveInteger(command.leaseGeneration) &&
    typeof command.claimToken === "string" &&
    tokenPattern.test(command.claimToken) &&
    isUuid(command.ownerId) &&
    typeof command.idempotencyKey === "string" &&
    idempotencyKeyPattern.test(command.idempotencyKey) &&
    typeof command.payloadDigest === "string" &&
    digestPattern.test(command.payloadDigest)
  );
}

function settlementIdentityIsValid(identity) {
  return (
    hasExactKeys(identity, ["idempotencyKey", "operationId", "ownerId", "requestId"]) &&
    idempotencyKeyPattern.test(identity.idempotencyKey) &&
    isUuid(identity.operationId) &&
    isUuid(identity.ownerId) &&
    isUuid(identity.requestId)
  );
}

function operationLeaseIsValid(lease, identity) {
  return (
    typeof lease === "object" &&
    lease !== null &&
    !Array.isArray(lease) &&
    lease.operationId === identity.operationId &&
    lease.ownerId === identity.ownerId &&
    isPositiveInteger(lease.leaseGeneration) &&
    typeof lease.claimToken === "string" &&
    tokenPattern.test(lease.claimToken)
  );
}

function receiptRequestIsValid(request, identity) {
  return (
    hasExactKeys(request, ["operationId", "ownerId", "requestId"]) &&
    request.operationId === identity.operationId &&
    request.ownerId === identity.ownerId &&
    request.requestId === identity.requestId
  );
}

function ledgerEntryIsValid(entry, receipt) {
  return (
    hasExactKeys(entry, [
      "cachedInputTokens",
      "callOrdinal",
      "costMicroUsd",
      "id",
      "inputTokens",
      "outcome",
      "outputTokens",
      "ownerId",
      "priceVersionId",
      "requestId",
    ]) &&
    isUuid(entry.id) &&
    entry.ownerId === receipt.request.ownerId &&
    entry.requestId === receipt.request.requestId &&
    entry.priceVersionId === receipt.priceVersionId &&
    isSafeNonnegativeInteger(entry.callOrdinal) &&
    isPositiveInteger(entry.inputTokens) &&
    isSafeNonnegativeInteger(entry.cachedInputTokens) &&
    entry.cachedInputTokens <= entry.inputTokens &&
    isPositiveInteger(entry.outputTokens) &&
    isSafeNonnegativeInteger(entry.costMicroUsd) &&
    entry.outcome === "succeeded"
  );
}

function receiptIsValid(receipt, identity) {
  if (
    !hasExactKeys(receipt, [
      "applicationRequestCount",
      "billedCallCount",
      "deadlineClassification",
      "deployments",
      "ledgerEntries",
      "model",
      "observedAt",
      "payloadDigest",
      "priceVersionId",
      "priceVersionSlot",
      "request",
      "reservationMicroUsd",
      "reservationStatus",
      "settlementSource",
      "terminalState",
    ]) ||
    receipt.applicationRequestCount !== 1 ||
    ![1, 2].includes(receipt.billedCallCount) ||
    receipt.deadlineClassification !== "completed-within-90-seconds" ||
    !deploymentsAreValid(receipt.deployments) ||
    !Array.isArray(receipt.ledgerEntries) ||
    receipt.ledgerEntries.length !== receipt.billedCallCount ||
    receipt.model !== "deepseek-v4-flash" ||
    parseUtcTimestamp(receipt.observedAt) === null ||
    typeof receipt.payloadDigest !== "string" ||
    !digestPattern.test(receipt.payloadDigest) ||
    !isUuid(receipt.priceVersionId) ||
    !["legacy", "off-peak", "peak"].includes(receipt.priceVersionSlot) ||
    !receiptRequestIsValid(receipt.request, identity) ||
    !isPositiveInteger(receipt.reservationMicroUsd) ||
    receipt.reservationStatus !== "settled" ||
    receipt.settlementSource !== "server-authority" ||
    receipt.terminalState !== "completed"
  ) {
    return false;
  }
  const ordinals = receipt.ledgerEntries.map(({ callOrdinal }) => callOrdinal);
  return (
    receipt.ledgerEntries.every((entry) => ledgerEntryIsValid(entry, receipt)) &&
    ordinals.every((ordinal, index) => ordinal === index) &&
    new Set(receipt.ledgerEntries.map(({ id }) => id)).size === receipt.ledgerEntries.length
  );
}

function freezeSettlement(receipt, identity, receiptDigest) {
  const deployments = Object.freeze({
    api: Object.freeze({ ...receipt.deployments.api }),
    web: Object.freeze({ ...receipt.deployments.web }),
  });
  const ledgerEntries = Object.freeze(
    receipt.ledgerEntries.map((entry) => Object.freeze({ ...entry })),
  );
  const settlement = {
    applicationRequestCount: receipt.applicationRequestCount,
    billedCallCount: receipt.billedCallCount,
    deadlineClassification: receipt.deadlineClassification,
    deployments,
    ledgerEntries,
    model: receipt.model,
    observedAt: receipt.observedAt,
    priceVersionId: receipt.priceVersionId,
    priceVersionSlot: receipt.priceVersionSlot,
    request: Object.freeze({ ...identity }),
    reservationMicroUsd: receipt.reservationMicroUsd,
    reservationStatus: receipt.reservationStatus,
    settlementSource: receipt.settlementSource,
    terminalState: receipt.terminalState,
  };
  Object.defineProperty(settlement, "receiptDigest", {
    enumerable: false,
    value: receiptDigest,
  });
  return Object.freeze(settlement);
}

export function createHostedDeepSeekPostgresEvidence({ query } = {}) {
  if (typeof query !== "function") throw failedClosed();
  return Object.freeze({
    async readServerSettlement(identity, control, operationLease) {
      try {
        if (
          !settlementIdentityIsValid(identity) ||
          !operationLeaseIsValid(operationLease, identity)
        ) {
          throw failedClosed();
        }
        const row = oneRow(
          await query(
            `SELECT receipt, receipt_digest AS "receiptDigest"
             FROM huayi_private.read_and_freeze_hosted_acceptance_settlement($1,$2,$3,$4)`,
            [
              operationLease.operationId,
              operationLease.leaseGeneration,
              operationLease.claimToken,
              identity.requestId,
            ],
            control,
          ),
        );
        if (
          !digestPattern.test(row.receiptDigest ?? "") ||
          !receiptIsValid(row.receipt, identity)
        ) {
          throw failedClosed();
        }
        return freezeSettlement(row.receipt, identity, row.receiptDigest);
      } catch {
        throw failedClosed();
      }
    },
    async reconcileDispatchedRequest(command, control) {
      try {
        if (!reconciliationCommandIsValid(command)) throw failedClosed();
        const row = oneRow(
          await query(
            `SELECT request_id::text AS "requestId"
             FROM huayi_private.reconcile_and_bind_hosted_acceptance_request(
               $1,$2,$3,$4,$5,$6
             )`,
            [
              command.operationId,
              command.leaseGeneration,
              command.claimToken,
              command.ownerId,
              command.idempotencyKey,
              command.payloadDigest,
            ],
            control,
          ),
        );
        if (!isUuid(row.requestId)) throw failedClosed();
        return Object.freeze({
          complete: true,
          matches: Object.freeze([
            Object.freeze({
              idempotencyKey: command.idempotencyKey,
              ownerId: command.ownerId,
              payloadDigest: command.payloadDigest,
              requestId: row.requestId,
            }),
          ]),
        });
      } catch {
        throw failedClosed();
      }
    },
  });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const tokenPattern = /^[A-Za-z0-9_-]{8,128}$/u;

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

export function isSafeNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function parseUtcTimestamp(value) {
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  ) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isUuid(value) {
  return typeof value === "string" && uuidPattern.test(value);
}

function isToken(value) {
  return typeof value === "string" && tokenPattern.test(value);
}

function operationIdentityValuesAreValid(identity) {
  return (
    isRecord(identity) &&
    typeof identity.idempotencyKey === "string" &&
    /^[A-Za-z0-9._:-]{8,128}$/u.test(identity.idempotencyKey) &&
    isUuid(identity.operationId) &&
    isUuid(identity.ownerId)
  );
}

function operationIdentityIsValid(identity) {
  return (
    hasExactKeys(identity, ["idempotencyKey", "operationId", "ownerId"]) &&
    operationIdentityValuesAreValid(identity)
  );
}

export function identitiesMatch(left, right) {
  return (
    operationIdentityValuesAreValid(left) &&
    operationIdentityValuesAreValid(right) &&
    isUuid(left.requestId) &&
    isUuid(right.requestId) &&
    left.idempotencyKey === right.idempotencyKey &&
    left.operationId === right.operationId &&
    left.ownerId === right.ownerId &&
    left.requestId === right.requestId
  );
}

export function approvalIsValid(approval, confirmation) {
  return (
    hasExactKeys(approval, ["candidateCommit", "confirmation", "maximumReservationMicroUsd"]) &&
    /^[0-9a-f]{40}$/u.test(approval.candidateCommit) &&
    approval.confirmation === confirmation &&
    isSafePositiveInteger(approval.maximumReservationMicroUsd)
  );
}

export function operationIdentity(authority) {
  return Object.freeze({
    idempotencyKey: authority.idempotencyKey,
    operationId: authority.operationId,
    ownerId: authority.ownerId,
  });
}

function deploymentIsValid(deployment) {
  return (
    hasExactKeys(deployment, ["commit", "deploymentId", "state"]) &&
    /^[0-9a-f]{40}$/u.test(deployment.commit) &&
    isToken(deployment.deploymentId) &&
    deployment.state === "READY"
  );
}

export function deploymentsAreValid(deployments) {
  return (
    hasExactKeys(deployments, ["api", "web"]) &&
    deploymentIsValid(deployments.api) &&
    deploymentIsValid(deployments.web) &&
    deployments.api.deploymentId !== deployments.web.deploymentId
  );
}

export function deploymentsMatch(left, right) {
  return (
    hasExactKeys(left, ["api", "web"]) &&
    hasExactKeys(right, ["api", "web"]) &&
    ["api", "web"].every(
      (project) =>
        left[project].commit === right[project].commit &&
        left[project].deploymentId === right[project].deploymentId &&
        left[project].state === right[project].state,
    )
  );
}

function authorizationIsValid(authorization, nowMilliseconds, freshnessMilliseconds) {
  if (
    !hasExactKeys(authorization, ["access", "observedAt", "operator", "reauthenticatedAt"]) ||
    authorization.access !== "full" ||
    authorization.operator !== true
  ) {
    return false;
  }
  const observedAt = parseUtcTimestamp(authorization.observedAt);
  const reauthenticatedAt = parseUtcTimestamp(authorization.reauthenticatedAt);
  return (
    observedAt !== null &&
    reauthenticatedAt !== null &&
    observedAt >= reauthenticatedAt &&
    observedAt <= nowMilliseconds &&
    nowMilliseconds - observedAt <= freshnessMilliseconds &&
    reauthenticatedAt <= nowMilliseconds &&
    nowMilliseconds - reauthenticatedAt <= 15 * 60 * 1_000
  );
}

function budgetIsValid(budget, approval) {
  return (
    hasExactKeys(budget, ["availableMicroUsd", "currency", "estimatedPeakReservationMicroUsd"]) &&
    budget.currency === "micro-usd" &&
    isSafePositiveInteger(budget.availableMicroUsd) &&
    isSafePositiveInteger(budget.estimatedPeakReservationMicroUsd) &&
    budget.estimatedPeakReservationMicroUsd <= budget.availableMicroUsd &&
    budget.estimatedPeakReservationMicroUsd <= approval.maximumReservationMicroUsd
  );
}

function candidateIsValid(candidate, approval) {
  return (
    hasExactKeys(candidate, ["branch", "clean", "commit", "pushed", "upstreamCommit"]) &&
    typeof candidate.branch === "string" &&
    /^[A-Za-z0-9._/-]{1,128}$/u.test(candidate.branch) &&
    candidate.clean === true &&
    candidate.pushed === true &&
    candidate.commit === approval.candidateCommit &&
    candidate.upstreamCommit === approval.candidateCommit
  );
}

function usageTotalsAreValid(usage) {
  return (
    hasExactKeys(usage, [
      "cachedInputTokens",
      "costMicroUsd",
      "inputTokens",
      "ledgerEntryCount",
      "outputTokens",
    ]) &&
    Object.values(usage).every(isSafeNonnegativeInteger) &&
    usage.cachedInputTokens <= usage.inputTokens
  );
}

export function preSnapshotIsValid(snapshot, approval, nowMilliseconds, policy) {
  const observedAt = parseUtcTimestamp(snapshot?.observedAt);
  return (
    hasExactKeys(snapshot, [
      "authority",
      "authorization",
      "budget",
      "candidate",
      "deployments",
      "killSwitchEnabled",
      "observedAt",
      "ownerUsage",
      "route",
    ]) &&
    snapshot.authority === "hosted-read-only-snapshot" &&
    observedAt !== null &&
    observedAt <= nowMilliseconds &&
    nowMilliseconds - observedAt <= policy.freshnessMilliseconds &&
    authorizationIsValid(snapshot.authorization, nowMilliseconds, policy.freshnessMilliseconds) &&
    budgetIsValid(snapshot.budget, approval) &&
    candidateIsValid(snapshot.candidate, approval) &&
    deploymentsAreValid(snapshot.deployments) &&
    snapshot.killSwitchEnabled === true &&
    usageTotalsAreValid(snapshot.ownerUsage) &&
    hasExactKeys(snapshot.route, ["origin", "path"]) &&
    snapshot.route.origin === policy.origin &&
    snapshot.route.path === policy.path
  );
}

export function operationLeaseIsValid(lease, approval, requiredUntilMilliseconds) {
  const expiresAt = parseUtcTimestamp(lease?.leaseExpiresAt);
  return (
    hasExactKeys(lease, [
      "candidateCommit",
      "claimToken",
      "idempotencyKey",
      "leaseExpiresAt",
      "maximumReservationMicroUsd",
      "operationId",
      "ownerId",
    ]) &&
    operationIdentityIsValid(operationIdentity(lease)) &&
    lease.candidateCommit === approval.candidateCommit &&
    lease.maximumReservationMicroUsd === approval.maximumReservationMicroUsd &&
    isToken(lease.claimToken) &&
    expiresAt !== null &&
    expiresAt > requiredUntilMilliseconds
  );
}

export function cleanupLeaseIsValid(lease, identity, deployments, requiredUntilMilliseconds) {
  const expiresAt = parseUtcTimestamp(lease?.leaseExpiresAt);
  return (
    hasExactKeys(lease, [
      "cleanupId",
      "cleanupToken",
      "deployments",
      "desiredKillSwitchEnabled",
      "idempotencyKey",
      "leaseExpiresAt",
      "operationId",
      "ownerId",
    ]) &&
    operationIdentityValuesAreValid(lease) &&
    operationIdentityValuesAreValid(identity) &&
    lease.idempotencyKey === identity.idempotencyKey &&
    lease.operationId === identity.operationId &&
    lease.ownerId === identity.ownerId &&
    isUuid(lease.cleanupId) &&
    isToken(lease.cleanupToken) &&
    expiresAt !== null &&
    expiresAt > requiredUntilMilliseconds &&
    lease.desiredKillSwitchEnabled === true &&
    deploymentsMatch(lease.deployments, deployments)
  );
}

export function dispatchAttemptReceiptIsValid(receipt, operationLease) {
  return (
    hasExactKeys(receipt, ["operationId", "status"]) &&
    receipt.operationId === operationLease.operationId &&
    receipt.status === "dispatch-attempted"
  );
}

export function requestHandleIsValid(handle) {
  return (
    hasExactKeys(handle, ["requestId", "type"]) &&
    isUuid(handle.requestId) &&
    handle.type === "analysis.started"
  );
}

export function requestBindingIsValid(binding, operationLease, requestHandle) {
  return (
    hasExactKeys(binding, ["idempotencyKey", "operationId", "ownerId", "requestId", "status"]) &&
    operationIdentityValuesAreValid(binding) &&
    binding.idempotencyKey === operationLease.idempotencyKey &&
    binding.operationId === operationLease.operationId &&
    binding.ownerId === operationLease.ownerId &&
    binding.requestId === requestHandle.requestId &&
    binding.status === "bound"
  );
}

export function completionReceiptIsValid(receipt, expected) {
  return (
    hasExactKeys(receipt, Object.keys(expected)) &&
    Object.entries(expected).every(([key, value]) => receipt[key] === value)
  );
}

import {
  deploymentsMatch,
  hasExactKeys,
  identitiesMatch,
  isSafeNonnegativeInteger,
  parseUtcTimestamp,
} from "./acceptance-hosted-deepseek-one-shot-contract.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isSafePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isUuid(value) {
  return typeof value === "string" && uuidPattern.test(value);
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

function ledgerEntryIsValid(entry, identity, priceVersionId) {
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
    entry.ownerId === identity.ownerId &&
    entry.requestId === identity.requestId &&
    entry.priceVersionId === priceVersionId &&
    isSafePositiveInteger(entry.callOrdinal) &&
    isSafePositiveInteger(entry.inputTokens) &&
    isSafeNonnegativeInteger(entry.cachedInputTokens) &&
    entry.cachedInputTokens <= entry.inputTokens &&
    isSafePositiveInteger(entry.outputTokens) &&
    isSafeNonnegativeInteger(entry.costMicroUsd) &&
    entry.outcome === "succeeded"
  );
}

export function settlementIsValid(settlement, approval, preSnapshot, identity) {
  if (
    !hasExactKeys(settlement, [
      "applicationRequestCount",
      "billedCallCount",
      "deadlineClassification",
      "deployments",
      "ledgerEntries",
      "model",
      "observedAt",
      "priceVersionId",
      "priceVersionSlot",
      "request",
      "reservationMicroUsd",
      "reservationStatus",
      "settlementSource",
      "terminalState",
    ]) ||
    settlement.applicationRequestCount !== 1 ||
    ![1, 2].includes(settlement.billedCallCount) ||
    settlement.deadlineClassification !== "completed-within-90-seconds" ||
    !deploymentsMatch(settlement.deployments, preSnapshot.deployments) ||
    !Array.isArray(settlement.ledgerEntries) ||
    settlement.ledgerEntries.length !== settlement.billedCallCount ||
    settlement.model !== "deepseek-v4-flash" ||
    parseUtcTimestamp(settlement.observedAt) === null ||
    parseUtcTimestamp(settlement.observedAt) < parseUtcTimestamp(preSnapshot.observedAt) ||
    !isUuid(settlement.priceVersionId) ||
    !["legacy", "off-peak", "peak"].includes(settlement.priceVersionSlot) ||
    !hasExactKeys(settlement.request, ["idempotencyKey", "operationId", "ownerId", "requestId"]) ||
    !identitiesMatch(settlement.request, identity) ||
    settlement.reservationMicroUsd !== preSnapshot.budget.estimatedPeakReservationMicroUsd ||
    settlement.reservationMicroUsd > approval.maximumReservationMicroUsd ||
    settlement.reservationStatus !== "settled" ||
    settlement.settlementSource !== "server-authority" ||
    settlement.terminalState !== "completed"
  ) {
    return false;
  }
  const ordinals = settlement.ledgerEntries.map(({ callOrdinal }) => callOrdinal).sort();
  const costMicroUsd = settlement.ledgerEntries.reduce(
    (total, entry) => total + entry.costMicroUsd,
    0,
  );
  return (
    settlement.ledgerEntries.every((entry) =>
      ledgerEntryIsValid(entry, identity, settlement.priceVersionId),
    ) &&
    ordinals.every((ordinal, index) => ordinal === index + 1) &&
    new Set(settlement.ledgerEntries.map(({ id }) => id)).size ===
      settlement.ledgerEntries.length &&
    costMicroUsd > 0 &&
    costMicroUsd <= settlement.reservationMicroUsd
  );
}

function postSnapshotHasValidShape(snapshot) {
  return (
    hasExactKeys(snapshot, [
      "applicationRequestCountDelta",
      "authority",
      "deployments",
      "killSwitchEnabled",
      "observedAt",
      "ownerUsage",
      "request",
      "reservationStatus",
      "terminalRequestCountDelta",
    ]) &&
    snapshot.authority === "hosted-read-only-snapshot" &&
    [0, 1].includes(snapshot.applicationRequestCountDelta) &&
    typeof snapshot.killSwitchEnabled === "boolean" &&
    parseUtcTimestamp(snapshot.observedAt) !== null &&
    usageTotalsAreValid(snapshot.ownerUsage) &&
    hasExactKeys(snapshot.request, ["idempotencyKey", "operationId", "ownerId", "requestId"]) &&
    identitiesMatch(snapshot.request, snapshot.request) &&
    ["active", "none", "released", "settled"].includes(snapshot.reservationStatus) &&
    [0, 1].includes(snapshot.terminalRequestCountDelta)
  );
}

export function postSnapshotProvesRestoration(
  snapshot,
  cleanupLease,
  nowMilliseconds,
  freshnessMilliseconds,
) {
  const observedAt = parseUtcTimestamp(snapshot?.observedAt);
  return (
    postSnapshotHasValidShape(snapshot) &&
    observedAt <= nowMilliseconds &&
    nowMilliseconds - observedAt <= freshnessMilliseconds &&
    snapshot.killSwitchEnabled === cleanupLease.desiredKillSwitchEnabled &&
    identitiesMatch(snapshot.request, cleanupLease) &&
    deploymentsMatch(snapshot.deployments, cleanupLease.deployments)
  );
}

function ledgerTotals(entries) {
  return entries.reduce(
    (totals, entry) => ({
      cachedInputTokens: totals.cachedInputTokens + entry.cachedInputTokens,
      costMicroUsd: totals.costMicroUsd + entry.costMicroUsd,
      inputTokens: totals.inputTokens + entry.inputTokens,
      ledgerEntryCount: totals.ledgerEntryCount + 1,
      outputTokens: totals.outputTokens + entry.outputTokens,
    }),
    { cachedInputTokens: 0, costMicroUsd: 0, inputTokens: 0, ledgerEntryCount: 0, outputTokens: 0 },
  );
}

export function postSnapshotProvesSuccess(
  snapshot,
  preSnapshot,
  settlement,
  cleanupLease,
  nowMilliseconds,
  freshnessMilliseconds,
) {
  if (
    !postSnapshotProvesRestoration(
      snapshot,
      cleanupLease,
      nowMilliseconds,
      freshnessMilliseconds,
    ) ||
    snapshot.applicationRequestCountDelta !== 1 ||
    snapshot.reservationStatus !== "settled" ||
    snapshot.terminalRequestCountDelta !== 1 ||
    parseUtcTimestamp(snapshot.observedAt) < parseUtcTimestamp(settlement.observedAt)
  ) {
    return false;
  }
  const expectedDelta = ledgerTotals(settlement.ledgerEntries);
  return Object.keys(expectedDelta).every(
    (field) => snapshot.ownerUsage[field] - preSnapshot.ownerUsage[field] === expectedDelta[field],
  );
}

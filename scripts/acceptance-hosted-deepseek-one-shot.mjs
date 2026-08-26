import { pathToFileURL } from "node:url";

export const hostedDeepSeekApplicationBudgetMilliseconds = 90_000;
export const hostedDeepSeekPreSnapshotFreshnessMilliseconds = 30_000;
export const hostedDeepSeekOneShotConfirmation =
  "--confirm-hosted-cloud-web-deepseek-one-shot-kpadiulxkgckskcfydry";
export const hostedDeepSeekWebOrigin = "https://app.acceptance.seen-said.cn";
export const hostedDeepSeekWebPath = "/analysis";

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";
const recentAuthenticationMilliseconds = 15 * 60 * 1_000;
const requiredAdapterMethods = Object.freeze([
  "capturePostSnapshot",
  "capturePreSnapshot",
  "invokeCloudWebAnalysis",
  "readServerSettlement",
  "setModelKillSwitch",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function isSafeNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function parseUtcTimestamp(value) {
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

function approvalIsValid(approval) {
  return (
    hasExactKeys(approval, ["candidateCommit", "confirmation", "maximumReservationMicroUsd"]) &&
    /^[0-9a-f]{40}$/u.test(approval.candidateCommit) &&
    approval.confirmation === hostedDeepSeekOneShotConfirmation &&
    isSafePositiveInteger(approval.maximumReservationMicroUsd)
  );
}

function adapterIsValid(adapter) {
  return (
    isRecord(adapter) &&
    requiredAdapterMethods.every((methodName) => typeof adapter[methodName] === "function")
  );
}

function authorizationIsValid(authorization, nowMilliseconds) {
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
    nowMilliseconds - observedAt <= hostedDeepSeekPreSnapshotFreshnessMilliseconds &&
    reauthenticatedAt <= nowMilliseconds &&
    nowMilliseconds - reauthenticatedAt <= recentAuthenticationMilliseconds
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

function preSnapshotIsValid(snapshot, approval, nowMilliseconds) {
  return (
    hasExactKeys(snapshot, [
      "authority",
      "authorization",
      "budget",
      "candidate",
      "killSwitchEnabled",
      "route",
    ]) &&
    snapshot.authority === "hosted-read-only-snapshot" &&
    authorizationIsValid(snapshot.authorization, nowMilliseconds) &&
    budgetIsValid(snapshot.budget, approval) &&
    candidateIsValid(snapshot.candidate, approval) &&
    snapshot.killSwitchEnabled === true &&
    hasExactKeys(snapshot.route, ["origin", "path"]) &&
    snapshot.route.origin === hostedDeepSeekWebOrigin &&
    snapshot.route.path === hostedDeepSeekWebPath
  );
}

function settlementIsValid(settlement, approval, preSnapshot) {
  if (
    !hasExactKeys(settlement, [
      "applicationRequestCount",
      "billedCallCount",
      "costReconciled",
      "deadlineClassification",
      "dispatched",
      "ledgerEntryCount",
      "ledgerReconciled",
      "model",
      "priceVersionReconciled",
      "priceVersionSlot",
      "reservationMicroUsd",
      "reservationSettled",
      "settlementSource",
      "terminalState",
      "usageReconciled",
    ]) ||
    settlement.applicationRequestCount !== 1 ||
    ![1, 2].includes(settlement.billedCallCount) ||
    settlement.ledgerEntryCount !== settlement.billedCallCount ||
    settlement.costReconciled !== true ||
    settlement.dispatched !== true ||
    settlement.ledgerReconciled !== true ||
    settlement.model !== "deepseek-v4-flash" ||
    settlement.priceVersionReconciled !== true ||
    !["legacy", "off-peak", "peak"].includes(settlement.priceVersionSlot) ||
    !isSafePositiveInteger(settlement.reservationMicroUsd) ||
    settlement.reservationMicroUsd !== preSnapshot.budget.estimatedPeakReservationMicroUsd ||
    settlement.reservationMicroUsd > approval.maximumReservationMicroUsd ||
    settlement.reservationMicroUsd > preSnapshot.budget.availableMicroUsd ||
    settlement.reservationSettled !== true ||
    settlement.settlementSource !== "server-authority" ||
    !["completed", "failed"].includes(settlement.terminalState) ||
    settlement.usageReconciled !== true
  ) {
    return false;
  }
  if (settlement.terminalState === "completed") {
    return settlement.deadlineClassification === "completed-within-90-seconds";
  }
  return [
    "application-abort-at-90-seconds",
    "failed-within-90-seconds",
    "platform-terminated",
  ].includes(settlement.deadlineClassification);
}

function postSnapshotHasValidShape(snapshot) {
  return (
    hasExactKeys(snapshot, [
      "applicationRequestCountDelta",
      "authority",
      "killSwitchEnabled",
      "ledgerEntryCountDelta",
      "reservationStatus",
      "terminalRequestCountDelta",
    ]) &&
    snapshot.authority === "hosted-read-only-snapshot" &&
    [0, 1].includes(snapshot.applicationRequestCountDelta) &&
    typeof snapshot.killSwitchEnabled === "boolean" &&
    isSafeNonnegativeInteger(snapshot.ledgerEntryCountDelta) &&
    snapshot.ledgerEntryCountDelta <= 2 &&
    ["active", "none", "released", "settled"].includes(snapshot.reservationStatus) &&
    [0, 1].includes(snapshot.terminalRequestCountDelta)
  );
}

function postSnapshotProvesSuccess(snapshot, originalKillSwitch, settlement) {
  return (
    postSnapshotHasValidShape(snapshot) &&
    snapshot.applicationRequestCountDelta === 1 &&
    snapshot.killSwitchEnabled === originalKillSwitch &&
    snapshot.ledgerEntryCountDelta === settlement.ledgerEntryCount &&
    snapshot.reservationStatus === "settled" &&
    snapshot.terminalRequestCountDelta === 1
  );
}

function failedClosed() {
  return new Error(failureMessage);
}

export function renderHostedDeepSeekOneShotPlan() {
  return `Hosted Cloud Web DeepSeek one-shot acceptance plan (zero filesystem / zero Git / zero network / zero Hosted write)
- Target only the fixed Cloud Web application path ${hostedDeepSeekWebOrigin}${hostedDeepSeekWebPath}; Classic \`pnpm smoke:deepseek\` is forbidden.
- This module has no default real executor and does not infer an admin endpoint, authentication flow, credential source, or remote response shape. A separately reviewed adapter may only normalize existing authority evidence and must use a hidden interactive channel for every credential; no token, key, or password may enter output, argv, or an inherited environment.
- Require the exact explicit confirmation, a clean and pushed candidate commit, full Operator access with reauthentication no more than 15 minutes old, 30-second pre-snapshot freshness sampled immediately after capture, and a caller-approved peak reservation cap.
- Capture a read-only pre-snapshot, prove the original DeepSeek kill switch is enabled, temporarily disable it, and issue at most one Cloud Web application request with a 90-second application budget. The budget and signal are adapter control only; never Web request body or Provider parameters.
- Reconcile only server-authoritative dispatch, reservation settlement, UsageLedger rows, usage, cost, model, durable price-version slot, and the bounded 90-second terminal classification. One application request may produce one or two billed Provider calls only because the documented single structure repair is inside that request.
- In finally, restore the original kill-switch state and capture a read-only post-snapshot on success, failure, or interruption. Reject unless the post-snapshot proves restoration and exactly one terminal application request on success.
`;
}

export async function orchestrateHostedDeepSeekOneShot({
  adapter,
  approval,
  readNowMilliseconds = Date.now,
  signal,
} = {}) {
  try {
    if (
      !approvalIsValid(approval) ||
      !adapterIsValid(adapter) ||
      typeof readNowMilliseconds !== "function" ||
      signal?.aborted === true
    ) {
      throw failedClosed();
    }
  } catch {
    throw failedClosed();
  }

  let originalKillSwitch;
  let mutationAttempted = false;
  let operationFailed = false;
  let postSnapshot;
  let settlement;
  const adapterControl = Object.freeze({
    applicationBudgetMilliseconds: hostedDeepSeekApplicationBudgetMilliseconds,
    signal,
  });
  const applicationRoute = Object.freeze({
    origin: hostedDeepSeekWebOrigin,
    path: hostedDeepSeekWebPath,
  });

  try {
    const preSnapshot = await adapter.capturePreSnapshot();
    const actionNowMilliseconds = readNowMilliseconds();
    if (
      !isSafeNonnegativeInteger(actionNowMilliseconds) ||
      !preSnapshotIsValid(preSnapshot, approval, actionNowMilliseconds) ||
      signal?.aborted === true
    ) {
      throw failedClosed();
    }
    originalKillSwitch = preSnapshot.killSwitchEnabled;
    mutationAttempted = true;
    await adapter.setModelKillSwitch(false);
    if (signal?.aborted === true) throw failedClosed();
    const requestHandle = await adapter.invokeCloudWebAnalysis(applicationRoute, adapterControl);
    if (signal?.aborted === true) throw failedClosed();
    settlement = await adapter.readServerSettlement(requestHandle, adapterControl);
    if (signal?.aborted === true) throw failedClosed();
    if (!settlementIsValid(settlement, approval, preSnapshot)) throw failedClosed();
    if (settlement.terminalState !== "completed") operationFailed = true;
  } catch {
    operationFailed = true;
  } finally {
    if (mutationAttempted) {
      try {
        await adapter.setModelKillSwitch(originalKillSwitch);
      } catch {
        operationFailed = true;
      }
      try {
        postSnapshot = await adapter.capturePostSnapshot();
        if (!postSnapshotHasValidShape(postSnapshot)) operationFailed = true;
      } catch {
        operationFailed = true;
      }
    }
  }

  if (
    operationFailed ||
    settlement === undefined ||
    postSnapshot === undefined ||
    !postSnapshotProvesSuccess(postSnapshot, originalKillSwitch, settlement)
  ) {
    throw failedClosed();
  }

  return Object.freeze({
    applicationPath: hostedDeepSeekWebPath,
    billedCallCount: settlement.billedCallCount,
    deadlineClassification: settlement.deadlineClassification,
    killSwitchRestored: true,
    outcome: "accepted",
    priceVersionSlot: settlement.priceVersionSlot,
    providerModel: settlement.model,
    requestCount: settlement.applicationRequestCount,
  });
}

export async function runHostedDeepSeekOneShotCli({
  arguments_ = process.argv.slice(2),
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "plan") {
    writeOutput(renderHostedDeepSeekOneShotPlan());
    return 0;
  }
  writeError(`${failureMessage}\n`);
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeepSeekOneShotCli();
}

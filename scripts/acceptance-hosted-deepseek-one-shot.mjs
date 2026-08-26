import { pathToFileURL } from "node:url";

import {
  approvalIsValid,
  cleanupLeaseIsValid,
  deploymentsAreValid,
  isSafeNonnegativeInteger,
  operationIdentity,
  operationIdIsValid,
  operationLeaseIsValid,
  preSnapshotIsValid,
  requestHandleIsValid,
} from "./acceptance-hosted-deepseek-one-shot-contract.mjs";
import {
  postSnapshotProvesSuccess,
  settlementIsValid,
} from "./acceptance-hosted-deepseek-one-shot-evidence.mjs";
import {
  attemptCleanup,
  completeOperation,
  createApplicationDeadline,
  createApplicationRequest,
  createCleanupCommand,
  executionDependenciesAreValid,
} from "./acceptance-hosted-deepseek-one-shot-runtime.mjs";

export const hostedDeepSeekApplicationBudgetMilliseconds = 90_000;
export const hostedDeepSeekCleanupBudgetMilliseconds = 10_000;
export const hostedDeepSeekPreSnapshotFreshnessMilliseconds = 30_000;
export const hostedDeepSeekOneShotConfirmation =
  "--confirm-hosted-cloud-web-deepseek-one-shot-kpadiulxkgckskcfydry";
export const hostedDeepSeekWebOrigin = "https://app.acceptance.seen-said.cn";
export const hostedDeepSeekWebPath = "/analysis";

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";
const policy = Object.freeze({
  freshnessMilliseconds: hostedDeepSeekPreSnapshotFreshnessMilliseconds,
  origin: hostedDeepSeekWebOrigin,
  path: hostedDeepSeekWebPath,
});

function failedClosed() {
  return new Error(failureMessage);
}

export function renderHostedDeepSeekOneShotPlan() {
  return `Hosted Cloud Web DeepSeek one-shot acceptance plan (zero filesystem / zero Git / zero network / zero Hosted write)
- Target only the fixed Cloud Web application path ${hostedDeepSeekWebOrigin}${hostedDeepSeekWebPath}; Classic \`pnpm smoke:deepseek\` is forbidden.
- This module has no default real executor and does not infer an admin endpoint, authentication flow, credential source, durable store, or remote response shape. Separately reviewed adapters must use a hidden interactive channel for every credential; no token, key, or password may enter output, argv, or an inherited environment.
- Require the exact explicit confirmation plus a unique operation, request, owner, and idempotency identity. A durable lifecycle adapter must atomically consume the operation before any Hosted read; the same approval can never dispatch twice, including under concurrent replay.
- Require a clean and pushed candidate commit, READY Hosted API and Web deployments on that exact SHA, full Operator access with recent reauthentication, a 30-second pre-snapshot, and a caller-approved peak reservation cap.
- Before disabling the DeepSeek kill switch, durably arm a reclaimable cleanup lease. Both validated leases must outlive the complete 90-second mutation window. Local and recovery cleanup attempts have an independent absolute 10-second bound; timeout leaves the durable record pending for atomic reclaim without replaying the application request.
- The orchestrator owns one absolute 90-second deadline across kill-switch disable, one Cloud Web application request, and server settlement. Its deadline wins even if an adapter ignores abort. Budget, deadline, and signal are adapter control only; never Web request body or Provider parameters.
- Accept only fresh server-authoritative evidence bound to the same API/Web deployment IDs and SHAs, operation, request, owner, idempotency key, actual price-version UUID, token usage, cost, reservation, and one-or-two-row UsageLedger delta. A fresh post-snapshot must prove restoration and the exact owner-usage delta.
`;
}

export async function orchestrateHostedDeepSeekOneShot({
  adapter,
  approval,
  clearTimeout_ = clearTimeout,
  lifecycle,
  readNowMilliseconds = Date.now,
  setTimeout_ = setTimeout,
  signal,
} = {}) {
  try {
    if (
      !approvalIsValid(approval, hostedDeepSeekOneShotConfirmation) ||
      !executionDependenciesAreValid({
        adapter,
        clearTimeout_,
        lifecycle,
        readNowMilliseconds,
        setTimeout_,
        signal,
      })
    ) {
      throw failedClosed();
    }
  } catch {
    throw failedClosed();
  }

  const identity = operationIdentity(approval);
  let accepted = false;
  let cleanupCompleted = false;
  let cleanupLease;
  let operationFailed = false;
  let operationLease;
  let postSnapshot;
  let preSnapshot;
  let settlement;

  try {
    const operationLeaseCandidate = await lifecycle.claimOperation({
      ...identity,
      candidateCommit: approval.candidateCommit,
      confirmation: approval.confirmation,
      maximumReservationMicroUsd: approval.maximumReservationMicroUsd,
    });
    const claimNowMilliseconds = readNowMilliseconds();
    if (
      !isSafeNonnegativeInteger(claimNowMilliseconds) ||
      !operationLeaseIsValid(operationLeaseCandidate, approval, claimNowMilliseconds)
    ) {
      throw failedClosed();
    }
    operationLease = operationLeaseCandidate;
    preSnapshot = await adapter.capturePreSnapshot();
    const actionNowMilliseconds = readNowMilliseconds();
    if (
      !isSafeNonnegativeInteger(actionNowMilliseconds) ||
      !operationLeaseIsValid(operationLease, approval, actionNowMilliseconds) ||
      !preSnapshotIsValid(preSnapshot, approval, actionNowMilliseconds, policy) ||
      signal?.aborted === true
    ) {
      throw failedClosed();
    }
    const cleanupLeaseCandidate = await lifecycle.armCleanup(
      createCleanupCommand(operationLease, preSnapshot),
    );
    const deadlineStartMilliseconds = readNowMilliseconds();
    const applicationDeadlineAt =
      deadlineStartMilliseconds + hostedDeepSeekApplicationBudgetMilliseconds;
    const cleanupLeaseRequiredUntil =
      applicationDeadlineAt + hostedDeepSeekCleanupBudgetMilliseconds;
    if (
      !isSafeNonnegativeInteger(deadlineStartMilliseconds) ||
      !isSafeNonnegativeInteger(applicationDeadlineAt) ||
      !isSafeNonnegativeInteger(cleanupLeaseRequiredUntil) ||
      !operationLeaseIsValid(operationLease, approval, applicationDeadlineAt) ||
      !preSnapshotIsValid(preSnapshot, approval, deadlineStartMilliseconds, policy) ||
      !cleanupLeaseIsValid(
        cleanupLeaseCandidate,
        identity,
        preSnapshot.deployments,
        cleanupLeaseRequiredUntil,
      ) ||
      signal?.aborted === true
    ) {
      throw failedClosed();
    }
    cleanupLease = cleanupLeaseCandidate;

    const deadline = createApplicationDeadline({
      budgetMilliseconds: hostedDeepSeekApplicationBudgetMilliseconds,
      clearTimeout_,
      deadlineAt: applicationDeadlineAt,
      externalSignal: signal,
      setTimeout_,
    });
    try {
      await deadline.run(() => adapter.setModelKillSwitch(false, deadline.control));
      const requestHandle = await deadline.run(() =>
        adapter.invokeCloudWebAnalysis(
          createApplicationRequest(identity, preSnapshot.deployments, policy),
          deadline.control,
        ),
      );
      if (!requestHandleIsValid(requestHandle, identity)) throw failedClosed();
      settlement = await deadline.run(() =>
        adapter.readServerSettlement(requestHandle, deadline.control),
      );
      if (!settlementIsValid(settlement, approval, preSnapshot, identity)) throw failedClosed();
    } catch {
      operationFailed = true;
    } finally {
      deadline.stop();
    }
  } catch {
    operationFailed = true;
  } finally {
    if (cleanupLease !== undefined) {
      const cleanupAttempt = await attemptCleanup({
        adapter,
        budgetMilliseconds: hostedDeepSeekCleanupBudgetMilliseconds,
        clearTimeout_,
        freshnessMilliseconds: hostedDeepSeekPreSnapshotFreshnessMilliseconds,
        lease: cleanupLease,
        lifecycle,
        readNowMilliseconds,
        setTimeout_,
      });
      cleanupCompleted = cleanupAttempt.completed;
      postSnapshot = cleanupAttempt.postSnapshot;
      if (!cleanupCompleted) operationFailed = true;
    }

    if (
      !operationFailed &&
      cleanupCompleted &&
      settlement !== undefined &&
      postSnapshot !== undefined
    ) {
      const postNowMilliseconds = readNowMilliseconds();
      accepted =
        isSafeNonnegativeInteger(postNowMilliseconds) &&
        postSnapshotProvesSuccess(
          postSnapshot,
          preSnapshot,
          settlement,
          cleanupLease,
          postNowMilliseconds,
          hostedDeepSeekPreSnapshotFreshnessMilliseconds,
        );
      if (!accepted) operationFailed = true;
    }

    if (operationLease !== undefined) {
      const outcome = accepted
        ? "accepted"
        : cleanupLease !== undefined && !cleanupCompleted
          ? "failed-cleanup-pending"
          : "failed";
      try {
        if (!(await completeOperation({ lifecycle, operationLease, outcome }))) {
          accepted = false;
          operationFailed = true;
        }
      } catch {
        accepted = false;
        operationFailed = true;
      }
    }
  }

  if (!accepted || operationFailed || settlement === undefined) throw failedClosed();
  const usage = settlement.ledgerEntries.reduce(
    (total, entry) => ({
      cachedInputTokens: total.cachedInputTokens + entry.cachedInputTokens,
      costMicroUsd: total.costMicroUsd + entry.costMicroUsd,
      inputTokens: total.inputTokens + entry.inputTokens,
      outputTokens: total.outputTokens + entry.outputTokens,
    }),
    { cachedInputTokens: 0, costMicroUsd: 0, inputTokens: 0, outputTokens: 0 },
  );
  return Object.freeze({
    applicationPath: hostedDeepSeekWebPath,
    billedCallCount: settlement.billedCallCount,
    deadlineClassification: settlement.deadlineClassification,
    killSwitchRestored: true,
    outcome: "accepted",
    priceVersionId: settlement.priceVersionId,
    priceVersionSlot: settlement.priceVersionSlot,
    providerModel: settlement.model,
    requestCount: settlement.applicationRequestCount,
    requestId: identity.requestId,
    usage: Object.freeze(usage),
  });
}

export async function recoverHostedDeepSeekOneShotCleanup({
  adapter,
  clearTimeout_ = clearTimeout,
  lifecycle,
  operationId,
  readNowMilliseconds = Date.now,
  setTimeout_ = setTimeout,
} = {}) {
  try {
    if (
      !operationIdIsValid(operationId) ||
      !executionDependenciesAreValid({
        adapter,
        clearTimeout_,
        lifecycle,
        readNowMilliseconds,
        setTimeout_,
      })
    ) {
      throw failedClosed();
    }
    const cleanupLeaseCandidate = await lifecycle.claimCleanup({ operationId });
    const nowMilliseconds = readNowMilliseconds();
    const cleanupDeadlineAt = nowMilliseconds + hostedDeepSeekCleanupBudgetMilliseconds;
    if (
      !isSafeNonnegativeInteger(nowMilliseconds) ||
      !isSafeNonnegativeInteger(cleanupDeadlineAt) ||
      !cleanupLeaseIsValid(
        cleanupLeaseCandidate,
        operationIdentity(cleanupLeaseCandidate),
        cleanupLeaseCandidate.deployments,
        cleanupDeadlineAt,
      ) ||
      cleanupLeaseCandidate.operationId !== operationId ||
      !deploymentsAreValid(
        cleanupLeaseCandidate.deployments,
        cleanupLeaseCandidate.deployments.api.commit,
      )
    ) {
      throw failedClosed();
    }
    const cleanupLease = cleanupLeaseCandidate;
    const cleanupAttempt = await attemptCleanup({
      adapter,
      budgetMilliseconds: hostedDeepSeekCleanupBudgetMilliseconds,
      clearTimeout_,
      freshnessMilliseconds: hostedDeepSeekPreSnapshotFreshnessMilliseconds,
      lease: cleanupLease,
      lifecycle,
      readNowMilliseconds,
      setTimeout_,
    });
    if (!cleanupAttempt.completed) throw failedClosed();
    return Object.freeze({
      cleanupId: cleanupLease.cleanupId,
      operationId,
      outcome: "restored",
    });
  } catch {
    throw failedClosed();
  }
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

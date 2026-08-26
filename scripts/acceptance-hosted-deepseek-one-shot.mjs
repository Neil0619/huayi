import { pathToFileURL } from "node:url";

import {
  approvalIsValid,
  cleanupLeaseIsValid,
  deploymentsAreValid,
  dispatchAttemptReceiptIsValid,
  isSafeNonnegativeInteger,
  operationIdentity,
  operationLeaseIsValid,
  preSnapshotIsValid,
  requestBindingIsValid,
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
export const hostedDeepSeekAnalysisStreamPath = "/v1/analyses:stream";

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";
const policy = Object.freeze({
  freshnessMilliseconds: hostedDeepSeekPreSnapshotFreshnessMilliseconds,
  origin: hostedDeepSeekWebOrigin,
  path: hostedDeepSeekWebPath,
});
const applicationRoute = Object.freeze({
  origin: hostedDeepSeekWebOrigin,
  path: hostedDeepSeekAnalysisStreamPath,
});

function failedClosed() {
  return new Error(failureMessage);
}

export function renderHostedDeepSeekOneShotPlan() {
  return `Hosted Cloud Web DeepSeek one-shot acceptance plan (zero filesystem / zero Git / zero network / zero Hosted write)
- Attest the fixed Cloud Web page ${hostedDeepSeekWebOrigin}${hostedDeepSeekWebPath}, then send exactly one normal product request to ${hostedDeepSeekAnalysisStreamPath}; Classic \`pnpm smoke:deepseek\` is forbidden.
- This module has no default real executor and does not infer an admin endpoint, authentication flow, credential source, durable store, or remote response shape. Separately reviewed adapters must use a hidden interactive channel for every credential; no token, key, or password may enter output, argv, or an inherited environment.
- Approval contains only the candidate commit, exact confirmation, and reservation cap. The durable authority generates operation and idempotency identities while atomically consuming the approval; the same approval can never dispatch twice. The server request ID is bound only from analysis.started after dispatch.
- Require a clean and pushed candidate commit, the exact READY Hosted API/Web deployment pair with independently attested full source SHAs, full Operator access with recent reauthentication, a 30-second pre-snapshot, and a caller-approved peak reservation cap.
- Before disabling the DeepSeek kill switch, durably arm a reclaimable cleanup lease. Both validated leases must outlive the complete 90-second mutation window. Local and recovery cleanup attempts have an independent absolute 10-second bound; timeout leaves the durable record pending for atomic reclaim without replaying the application request.
- Before the one Cloud Web HTTP request, persist dispatch-attempted. After its analysis.started event, bind that server-generated request ID before settlement; recovery claims only one unique pending cleanup and never accepts an opaque operation ID.
- The orchestrator owns one absolute 90-second deadline across kill-switch disable, dispatch, binding, and server settlement. Its deadline wins even if an adapter ignores abort. Budget, deadline, and signal are adapter control only; never Web request body or Provider parameters.
- Accept only fresh private server-authoritative evidence bound to the exact deployment pair and continuous zero-based UsageLedger calls. Public success is fixed and exposes no opaque IDs, price UUID, or token-usage details.
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

  let accepted = false;
  let cleanupCompleted = false;
  let cleanupLease;
  let identity;
  let operationFailed = false;
  let operationLease;
  let postSnapshot;
  let preSnapshot;
  let settlement;

  try {
    const operationLeaseCandidate = await lifecycle.claimOperation({ ...approval });
    const claimNowMilliseconds = readNowMilliseconds();
    if (
      !isSafeNonnegativeInteger(claimNowMilliseconds) ||
      !operationLeaseIsValid(operationLeaseCandidate, approval, claimNowMilliseconds)
    ) {
      throw failedClosed();
    }
    operationLease = operationLeaseCandidate;
    identity = operationIdentity(operationLease);
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
      const dispatchReceipt = await deadline.run(() =>
        lifecycle.markDispatchAttempted({
          claimToken: operationLease.claimToken,
          operationId: operationLease.operationId,
        }),
      );
      if (!dispatchAttemptReceiptIsValid(dispatchReceipt, operationLease)) throw failedClosed();
      const requestHandle = await deadline.run(() =>
        adapter.invokeCloudWebAnalysis(
          createApplicationRequest(identity, preSnapshot.deployments, applicationRoute),
          deadline.control,
        ),
      );
      if (!requestHandleIsValid(requestHandle)) throw failedClosed();
      const requestBinding = await deadline.run(() =>
        lifecycle.bindRequest({
          claimToken: operationLease.claimToken,
          idempotencyKey: operationLease.idempotencyKey,
          operationId: operationLease.operationId,
          ownerId: operationLease.ownerId,
          requestId: requestHandle.requestId,
        }),
      );
      if (!requestBindingIsValid(requestBinding, operationLease, requestHandle)) {
        throw failedClosed();
      }
      identity = Object.freeze({
        ...operationIdentity(requestBinding),
        requestId: requestBinding.requestId,
      });
      settlement = await deadline.run(() =>
        adapter.readServerSettlement(identity, deadline.control),
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
          identity,
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
  return Object.freeze({
    killSwitchRestored: true,
    outcome: "accepted",
  });
}

export async function recoverHostedDeepSeekOneShotCleanup(options = {}) {
  try {
    if (
      typeof options !== "object" ||
      options === null ||
      Array.isArray(options) ||
      ["idempotencyKey", "operationId", "ownerId", "requestId"].some((field) =>
        Object.hasOwn(options, field),
      )
    ) {
      throw failedClosed();
    }
    const {
      adapter,
      clearTimeout_ = clearTimeout,
      lifecycle,
      readNowMilliseconds = Date.now,
      setTimeout_ = setTimeout,
    } = options;
    if (
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
    const cleanupLeaseCandidate = await lifecycle.claimCleanup();
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
      !deploymentsAreValid(cleanupLeaseCandidate.deployments)
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
      killSwitchRestored: true,
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

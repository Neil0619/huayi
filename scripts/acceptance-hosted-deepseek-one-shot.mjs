import { pathToFileURL } from "node:url";

import {
  approvalIsValid,
  cleanupLeaseIsValid,
  dispatchAttemptReceiptIsValid,
  isSafeNonnegativeInteger,
  operationIdentity,
  operationLeaseIsValid,
  preSnapshotIsValid,
  reconciledRequestHandle,
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
  createReconciliationRequest,
  executionDependenciesAreValid,
  readHostedDeepSeekOneShotStatus,
  recoverHostedDeepSeekOneShotCleanup,
} from "./acceptance-hosted-deepseek-one-shot-runtime.mjs";

export const hostedDeepSeekApplicationBudgetMilliseconds = 90_000;
export const hostedDeepSeekCleanupBudgetMilliseconds = 10_000;
export const hostedDeepSeekPreSnapshotFreshnessMilliseconds = 30_000;
export const hostedDeepSeekStatusBudgetMilliseconds = 5_000;
export const hostedDeepSeekOneShotConfirmation =
  "--confirm-hosted-cloud-web-deepseek-one-shot-kpadiulxkgckskcfydry";
export const hostedDeepSeekWebOrigin = "https://app.acceptance.seen-said.cn";
export const hostedDeepSeekWebPath = "/analysis";
export const hostedDeepSeekAnalysisStreamPath = "/v1/analyses:stream";
export const hostedDeepSeekPayloadDigest =
  "7f260d4d76123414b9664dbd9851cba457fb38899ec4026fcc383c0792a07777";

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
- The only caller seam is status(), execute(approval), and recover(). Status is a read-only authority query with an absolute five-second bound; direct lifecycle and adapter stages remain private.
- Approval contains only the candidate commit, exact confirmation, and reservation cap. The durable authority generates operation and idempotency identities while atomically consuming the approval; the same approval can never dispatch twice. The server request ID is bound only from analysis.started after dispatch.
- Require a clean and pushed candidate commit, the exact READY Hosted API/Web deployment pair with independently attested full source SHAs, full Operator access with recent reauthentication, a 30-second pre-snapshot, and a caller-approved peak reservation cap.
- Before disabling the DeepSeek kill switch, durably arm a reclaimable cleanup lease. Both validated leases must outlive the complete 90-second mutation window. Local and recovery cleanup attempts have an independent absolute 10-second bound; timeout leaves the durable record pending for atomic reclaim without replaying the application request.
- Before the one Cloud Web HTTP request, persist dispatch-attempted. After its analysis.started event, bind that server-generated request ID before settlement; recovery claims only one unique pending cleanup and never accepts an opaque operation ID.
- If the POST disconnects before analysis.started, perform one bounded reconciliation by the authority-owned idempotency key, owner, and fixed payload digest. Bind exactly one match, continue settlement, and never POST again; zero, multiple, incomplete, or mismatched results fail closed.
- The orchestrator owns one absolute 90-second deadline across kill-switch disable, dispatch, binding, and server settlement. Its deadline wins even if an adapter ignores abort. Budget, deadline, and signal are adapter control only; never Web request body or Provider parameters.
- Accept only fresh private server-authoritative evidence bound to the exact deployment pair and continuous zero-based UsageLedger calls. Public success is fixed and exposes no opaque IDs, price UUID, or token-usage details.
`;
}

async function orchestrateHostedDeepSeekOneShot({
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
  let cleanupArmAttempted = false;
  let cleanupCompleted = false;
  let cleanupLease;
  let identity;
  let operationFailed = false;
  let operationLease;
  let postSnapshot;
  let preSnapshot;
  let settlement;

  try {
    preSnapshot = await adapter.capturePreSnapshot();
    const actionNowMilliseconds = readNowMilliseconds();
    if (
      !isSafeNonnegativeInteger(actionNowMilliseconds) ||
      !preSnapshotIsValid(preSnapshot, approval, actionNowMilliseconds, policy) ||
      signal?.aborted === true
    ) {
      throw failedClosed();
    }
    const operationLeaseCandidate = await lifecycle.claimOperation(
      Object.freeze({
        ...approval,
        deployments: preSnapshot.deployments,
        payloadDigest: hostedDeepSeekPayloadDigest,
      }),
    );
    if (!operationLeaseIsValid(operationLeaseCandidate, approval, actionNowMilliseconds)) {
      throw failedClosed();
    }
    operationLease = operationLeaseCandidate;
    identity = operationIdentity(operationLease);
    const claimNowMilliseconds = readNowMilliseconds();
    if (
      !isSafeNonnegativeInteger(claimNowMilliseconds) ||
      !operationLeaseIsValid(operationLease, approval, claimNowMilliseconds) ||
      !preSnapshotIsValid(preSnapshot, approval, claimNowMilliseconds, policy) ||
      signal?.aborted === true
    ) {
      throw failedClosed();
    }
    cleanupArmAttempted = true;
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
      !operationLeaseIsValid(operationLease, approval, cleanupLeaseRequiredUntil) ||
      !preSnapshotIsValid(preSnapshot, approval, deadlineStartMilliseconds, policy) ||
      !cleanupLeaseIsValid(
        cleanupLeaseCandidate,
        preSnapshot.deployments,
        cleanupLeaseRequiredUntil,
      ) ||
      cleanupLeaseCandidate.operationId !== identity.operationId ||
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
          leaseGeneration: operationLease.leaseGeneration,
          operationId: operationLease.operationId,
          payloadDigest: hostedDeepSeekPayloadDigest,
        }),
      );
      if (!dispatchAttemptReceiptIsValid(dispatchReceipt, operationLease)) throw failedClosed();
      let requestHandle;
      try {
        requestHandle = await deadline.run(() =>
          adapter.invokeCloudWebAnalysis(
            createApplicationRequest(identity, preSnapshot.deployments, applicationRoute),
            deadline.control,
          ),
        );
      } catch {
        const reconciliation = await deadline.run(() =>
          adapter.reconcileDispatchedRequest(
            createReconciliationRequest(identity, hostedDeepSeekPayloadDigest),
            deadline.control,
          ),
        );
        requestHandle = reconciledRequestHandle(
          reconciliation,
          identity,
          hostedDeepSeekPayloadDigest,
        );
      }
      if (!requestHandleIsValid(requestHandle)) throw failedClosed();
      const requestBinding = await deadline.run(() =>
        lifecycle.bindRequest({
          claimToken: operationLease.claimToken,
          idempotencyKey: operationLease.idempotencyKey,
          leaseGeneration: operationLease.leaseGeneration,
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
        : cleanupArmAttempted && !cleanupCompleted
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

export function createHostedDeepSeekOneShotExecutor({
  adapter,
  clearTimeout_ = clearTimeout,
  lifecycle,
  readNowMilliseconds = Date.now,
  setTimeout_ = setTimeout,
  signal,
} = {}) {
  const dependencies = Object.freeze({
    adapter,
    clearTimeout_,
    lifecycle,
    readNowMilliseconds,
    setTimeout_,
    signal,
  });
  return Object.freeze({
    async execute(...arguments_) {
      if (arguments_.length !== 1) throw failedClosed();
      return orchestrateHostedDeepSeekOneShot({
        ...dependencies,
        approval: arguments_[0],
      });
    },
    async recover(...arguments_) {
      if (arguments_.length !== 0) throw failedClosed();
      return recoverHostedDeepSeekOneShotCleanup({
        ...dependencies,
        budgetMilliseconds: hostedDeepSeekCleanupBudgetMilliseconds,
        freshnessMilliseconds: hostedDeepSeekPreSnapshotFreshnessMilliseconds,
      });
    },
    async status(...arguments_) {
      if (arguments_.length !== 0) throw failedClosed();
      return readHostedDeepSeekOneShotStatus({
        ...dependencies,
        budgetMilliseconds: hostedDeepSeekStatusBudgetMilliseconds,
      });
    },
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

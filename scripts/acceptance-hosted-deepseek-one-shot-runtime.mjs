import {
  cleanupCompletionReceiptIsValid,
  cleanupLeaseIsValid,
  completionReceiptIsValid,
  hasExactKeys,
  isSafeNonnegativeInteger,
} from "./acceptance-hosted-deepseek-one-shot-contract.mjs";
import { hostedDeepSeekAnalysisRequestBody } from "./acceptance-hosted-deepseek-one-shot-analysis-request.mjs";
import { postSnapshotProvesRestoration } from "./acceptance-hosted-deepseek-one-shot-evidence.mjs";

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";
const requiredAdapterMethods = Object.freeze([
  "capturePostSnapshot",
  "capturePreSnapshot",
  "destroySession",
  "invokeCloudWebAnalysis",
  "loginPassword",
  "logout",
  "readOperatorAuthorization",
  "reconcileDispatchedRequest",
  "reauthenticatePassword",
  "readServerSettlement",
  "setModelKillSwitch",
]);
const requiredLifecycleMethods = Object.freeze([
  "armCleanup",
  "bindRequest",
  "claimCleanup",
  "claimOperation",
  "completeCleanup",
  "completeOperation",
  "markDispatchAttempted",
  "readStatus",
]);
function failedClosed() {
  return new Error(failureMessage);
}
function methodsAreValid(value, methodNames) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    methodNames.every((methodName) => typeof value[methodName] === "function")
  );
}
function signalIsValid(signal) {
  return (
    signal === undefined ||
    (typeof signal === "object" &&
      signal !== null &&
      typeof signal.aborted === "boolean" &&
      typeof signal.addEventListener === "function" &&
      typeof signal.removeEventListener === "function")
  );
}
export function executionDependenciesAreValid({
  adapter,
  clearTimeout_,
  lifecycle,
  readNowMilliseconds,
  setTimeout_,
  signal,
}) {
  return (
    methodsAreValid(adapter, requiredAdapterMethods) &&
    methodsAreValid(lifecycle, requiredLifecycleMethods) &&
    typeof readNowMilliseconds === "function" &&
    typeof setTimeout_ === "function" &&
    typeof clearTimeout_ === "function" &&
    signalIsValid(signal) &&
    signal?.aborted !== true
  );
}
function createDeadline({
  budgetMilliseconds,
  controlBudgetField,
  clearTimeout_,
  deadlineAt,
  externalSignal,
  setTimeout_,
}) {
  const controller = new AbortController();
  let rejectDeadline;
  let stopped = false;
  const deadline = new Promise((_, reject) => {
    rejectDeadline = reject;
  });
  const abort = () => {
    if (stopped) return;
    controller.abort();
    rejectDeadline(failedClosed());
  };
  const timer = setTimeout_(abort, budgetMilliseconds);
  externalSignal?.addEventListener("abort", abort, { once: true });
  if (externalSignal?.aborted === true) abort();
  return {
    control: Object.freeze({
      [controlBudgetField]: budgetMilliseconds,
      deadlineAt,
      signal: controller.signal,
    }),
    async run(action) {
      const guardedAction = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw failedClosed();
        return action();
      });
      return Promise.race([guardedAction, deadline]);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout_(timer);
      externalSignal?.removeEventListener("abort", abort);
    },
  };
}
export function createApplicationDeadline(options) {
  return createDeadline({ ...options, controlBudgetField: "applicationBudgetMilliseconds" });
}

export function createCleanupDeadline(options) {
  return createDeadline({ ...options, controlBudgetField: "cleanupBudgetMilliseconds" });
}
export function createStatusDeadline(options) {
  return createDeadline({ ...options, controlBudgetField: "statusBudgetMilliseconds" });
}

export function statusDependenciesAreValid({
  clearTimeout_,
  lifecycle,
  readNowMilliseconds,
  setTimeout_,
}) {
  return (
    methodsAreValid(lifecycle, ["readStatus"]) &&
    typeof readNowMilliseconds === "function" &&
    typeof setTimeout_ === "function" &&
    typeof clearTimeout_ === "function"
  );
}
function safeStatusFromSnapshot(snapshot) {
  if (
    !hasExactKeys(snapshot, ["authority", "records"]) ||
    snapshot.authority !== "hosted-deepseek-one-shot" ||
    !Array.isArray(snapshot.records) ||
    snapshot.records.length > 1
  ) {
    return null;
  }
  if (snapshot.records.length === 0) return Object.freeze({ state: "absent" });
  const [record] = snapshot.records;
  if (
    !hasExactKeys(record, ["state"]) ||
    !["cleanup-pending", "ready", "running", "terminal"].includes(record.state)
  ) {
    return null;
  }
  return Object.freeze({ state: record.state });
}

export async function readHostedDeepSeekOneShotStatus({
  budgetMilliseconds,
  clearTimeout_,
  lifecycle,
  readNowMilliseconds,
  setTimeout_,
}) {
  let deadline;
  let failed = false;
  let status;
  try {
    if (
      !isSafeNonnegativeInteger(budgetMilliseconds) ||
      budgetMilliseconds === 0 ||
      !statusDependenciesAreValid({
        clearTimeout_,
        lifecycle,
        readNowMilliseconds,
        setTimeout_,
      })
    ) {
      throw failedClosed();
    }
    const startedAt = readNowMilliseconds();
    const deadlineAt = startedAt + budgetMilliseconds;
    if (!isSafeNonnegativeInteger(startedAt) || !isSafeNonnegativeInteger(deadlineAt)) {
      throw failedClosed();
    }
    deadline = createStatusDeadline({
      budgetMilliseconds,
      clearTimeout_,
      deadlineAt,
      setTimeout_,
    });
    status = safeStatusFromSnapshot(
      await deadline.run(() => lifecycle.readStatus(deadline.control)),
    );
    if (status === null) throw failedClosed();
  } catch {
    failed = true;
  }
  try {
    deadline?.stop();
  } catch {
    failed = true;
  }
  if (failed || status === undefined) throw failedClosed();
  return status;
}

export function createCleanupCommand(operationLease, preSnapshot) {
  return Object.freeze({
    claimToken: operationLease.claimToken,
    deployments: preSnapshot.deployments,
    desiredKillSwitchEnabled: preSnapshot.killSwitchEnabled,
    leaseGeneration: operationLease.leaseGeneration,
    observedAt: preSnapshot.observedAt,
    operationId: operationLease.operationId,
  });
}

export function createApplicationRequest(identity, deployments, route) {
  return Object.freeze({
    body: hostedDeepSeekAnalysisRequestBody,
    deployments,
    idempotencyKey: identity.idempotencyKey,
    operationId: identity.operationId,
    origin: route.origin,
    ownerId: identity.ownerId,
    path: route.path,
  });
}

export function createReconciliationRequest(identity, payloadDigest) {
  return Object.freeze({
    idempotencyKey: identity.idempotencyKey,
    ownerId: identity.ownerId,
    payloadDigest,
  });
}

export async function completeCleanup({ lifecycle, lease, postSnapshot }) {
  const receipt = await lifecycle.completeCleanup({
    claimGeneration: lease.claimGeneration,
    cleanupToken: lease.cleanupToken,
    observedAt: postSnapshot.observedAt,
    operationId: lease.operationId,
  });
  return cleanupCompletionReceiptIsValid(receipt, lease.operationId)
    ? receipt.operationState
    : null;
}

export async function completeOperation({ lifecycle, operationLease, outcome }) {
  const receipt = await lifecycle.completeOperation({
    claimToken: operationLease.claimToken,
    leaseGeneration: operationLease.leaseGeneration,
    operationId: operationLease.operationId,
    outcome,
  });
  return completionReceiptIsValid(receipt, {
    operationId: operationLease.operationId,
    outcome,
    status: "completed",
  });
}

export async function attemptCleanup({
  adapter,
  budgetMilliseconds,
  clearTimeout_,
  freshnessMilliseconds,
  lease,
  readNowMilliseconds,
  setTimeout_,
}) {
  let deadline;
  let postSnapshot;
  try {
    const startedAt = readNowMilliseconds();
    const deadlineAt = startedAt + budgetMilliseconds;
    if (
      !isSafeNonnegativeInteger(startedAt) ||
      !isSafeNonnegativeInteger(deadlineAt) ||
      !cleanupLeaseIsValid(lease, lease.deployments, deadlineAt)
    ) {
      return { completed: false, postSnapshot };
    }
    deadline = createCleanupDeadline({
      budgetMilliseconds,
      clearTimeout_,
      deadlineAt,
      setTimeout_,
    });
    let restorationFailed = false;
    try {
      await deadline.run(() =>
        adapter.setModelKillSwitch(lease.desiredKillSwitchEnabled, deadline.control),
      );
    } catch {
      restorationFailed = true;
    }
    if (deadline.control.signal.aborted) return { completed: false, postSnapshot };
    postSnapshot = await deadline.run(() => adapter.capturePostSnapshot(deadline.control));
    const observedAt = readNowMilliseconds();
    if (
      !isSafeNonnegativeInteger(observedAt) ||
      !postSnapshotProvesRestoration(postSnapshot, lease, observedAt, freshnessMilliseconds)
    ) {
      return { completed: false, postSnapshot };
    }
    if (restorationFailed) return { completed: false, postSnapshot };
    return { completed: true, postSnapshot };
  } catch {
    return { completed: false, postSnapshot };
  } finally {
    try {
      deadline?.stop();
    } catch {
      // The durable cleanup record stays pending when local timer cleanup fails.
    }
  }
}

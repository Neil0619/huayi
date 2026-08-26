import {
  cleanupLeaseIsValid,
  completionReceiptIsValid,
  isSafeNonnegativeInteger,
} from "./acceptance-hosted-deepseek-one-shot-contract.mjs";
import { postSnapshotProvesRestoration } from "./acceptance-hosted-deepseek-one-shot-evidence.mjs";

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";
const requiredAdapterMethods = Object.freeze([
  "capturePostSnapshot",
  "capturePreSnapshot",
  "invokeCloudWebAnalysis",
  "readServerSettlement",
  "setModelKillSwitch",
]);
const requiredLifecycleMethods = Object.freeze([
  "armCleanup",
  "claimCleanup",
  "claimOperation",
  "completeCleanup",
  "completeOperation",
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

export function createCleanupCommand(operationLease, preSnapshot) {
  return Object.freeze({
    claimToken: operationLease.claimToken,
    deployments: preSnapshot.deployments,
    desiredKillSwitchEnabled: preSnapshot.killSwitchEnabled,
    idempotencyKey: operationLease.idempotencyKey,
    observedAt: preSnapshot.observedAt,
    operationId: operationLease.operationId,
    ownerId: operationLease.ownerId,
    requestId: operationLease.requestId,
  });
}

export function createApplicationRequest(identity, deployments, route) {
  return Object.freeze({
    deployments,
    idempotencyKey: identity.idempotencyKey,
    operationId: identity.operationId,
    origin: route.origin,
    ownerId: identity.ownerId,
    path: route.path,
    requestId: identity.requestId,
  });
}

export async function completeCleanup({ lifecycle, lease, postSnapshot }) {
  const receipt = await lifecycle.completeCleanup({
    cleanupId: lease.cleanupId,
    cleanupToken: lease.cleanupToken,
    observedAt: postSnapshot.observedAt,
    operationId: lease.operationId,
  });
  return completionReceiptIsValid(receipt, {
    cleanupId: lease.cleanupId,
    status: "completed",
  });
}

export async function completeOperation({ lifecycle, operationLease, outcome }) {
  const receipt = await lifecycle.completeOperation({
    claimToken: operationLease.claimToken,
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
  lifecycle,
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
      !cleanupLeaseIsValid(lease, lease, lease.deployments, deadlineAt)
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
    const completed = await deadline.run(() => completeCleanup({ lifecycle, lease, postSnapshot }));
    return { completed, postSnapshot };
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

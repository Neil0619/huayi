import { hostedDeepSeekPayloadDigest } from "./acceptance-hosted-deepseek-one-shot.mjs";
import {
  authorization,
  cleanupLease,
  identity,
  operationLease,
  ownerId,
  postSnapshot,
  preSnapshot,
  requestHandle,
  requestId,
  settlement,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";

export function operationLifecycle({
  arm,
  bind,
  calls = [],
  claim,
  claimCleanup,
  dispatch,
  finishCleanup,
  finishOperation,
  pendingCleanup,
  statusSnapshot,
} = {}) {
  let claimed = false;
  let pending = pendingCleanup;
  let operationState = pending === undefined ? "absent" : "cleanup-pending";
  return {
    armCleanup: async (command) => {
      calls.push("arm-cleanup");
      const value = arm === undefined ? cleanupLease(command) : await arm(command);
      pending = value;
      return value;
    },
    bindRequest: async (command) => {
      calls.push("bind-request");
      return bind === undefined
        ? { ...identity({ requestId: command.requestId }), status: "bound" }
        : bind(command);
    },
    claimCleanup: async (...arguments_) => {
      calls.push("claim-cleanup");
      if (claimCleanup !== undefined) return claimCleanup(arguments_, pending);
      if (arguments_.length !== 0 || pending === undefined || Array.isArray(pending)) {
        throw new Error("cleanup unavailable");
      }
      return {
        ...pending,
        cleanupToken: "recovery_cleanup_token_001",
        leaseExpiresAt: "2026-08-26T02:11:03.001Z",
      };
    },
    claimOperation: async (command) => {
      calls.push("claim-operation");
      if (claim !== undefined) return claim(command, claimed);
      if (claimed) throw new Error("operation already claimed");
      claimed = true;
      operationState = "running";
      return operationLease(command);
    },
    completeCleanup: async (command) => {
      calls.push("complete-cleanup");
      const nextOperationState = operationState === "cleanup-pending" ? "terminal" : operationState;
      const value =
        finishCleanup === undefined
          ? {
              operationId: command.operationId,
              operationState: nextOperationState,
              status: "completed",
            }
          : await finishCleanup(command);
      if (value?.status === "completed") {
        pending = undefined;
        operationState = value.operationState;
      }
      return value;
    },
    completeOperation: async (command) => {
      calls.push(`complete-operation:${command.outcome}`);
      const value =
        finishOperation === undefined
          ? { operationId: command.operationId, outcome: command.outcome, status: "completed" }
          : await finishOperation(command);
      if (value?.status === "completed") {
        operationState =
          command.outcome === "failed-cleanup-pending" ? "cleanup-pending" : "terminal";
      }
      return value;
    },
    markDispatchAttempted: async (command) => {
      calls.push("mark-dispatch-attempted");
      return dispatch === undefined
        ? { operationId: command.operationId, status: "dispatch-attempted" }
        : dispatch(command);
    },
    pendingCleanup: () => pending,
    readStatus: async () => {
      calls.push("read-status");
      if (statusSnapshot !== undefined) {
        return typeof statusSnapshot === "function" ? statusSnapshot() : statusSnapshot;
      }
      return {
        authority: "hosted-deepseek-one-shot",
        records: operationState === "absent" ? [] : [{ state: operationState }],
      };
    },
  };
}

export function adapter({
  calls = [],
  destroy = () => undefined,
  invoke = async () => requestHandle(),
  login = async () => undefined,
  logout = async () => undefined,
  operator = authorization(),
  post = postSnapshot(),
  pre = preSnapshot(),
  reconcile = settlement(),
  reconcileDispatch = {
    complete: true,
    matches: [
      {
        idempotencyKey: identity().idempotencyKey,
        ownerId,
        payloadDigest: hostedDeepSeekPayloadDigest,
        requestId,
      },
    ],
  },
  reauthenticate = async () => undefined,
  setKillSwitch = async () => undefined,
} = {}) {
  return {
    capturePostSnapshot: async (control) => {
      calls.push("post-snapshot");
      return typeof post === "function" ? post(control) : post;
    },
    capturePreSnapshot: async () => {
      calls.push("pre-snapshot");
      return typeof pre === "function" ? pre() : pre;
    },
    destroySession: () => destroy(),
    invokeCloudWebAnalysis: async (request, control) => {
      calls.push(`request:${request.origin}${request.path}`);
      return invoke(request, control);
    },
    loginPassword: async (control) => {
      calls.push("login-password");
      return login(control);
    },
    logout: async (control) => {
      calls.push("logout");
      return logout(control);
    },
    readOperatorAuthorization: async (control) => {
      calls.push("operator-readback");
      return typeof operator === "function" ? operator(control) : operator;
    },
    reconcileDispatchedRequest: async (request, control) => {
      calls.push("reconcile-request");
      return typeof reconcileDispatch === "function"
        ? reconcileDispatch(request, control)
        : reconcileDispatch;
    },
    readServerSettlement: async (handle, control) => {
      calls.push("server-settlement");
      return typeof reconcile === "function" ? reconcile(handle, control) : reconcile;
    },
    reauthenticatePassword: async (control) => {
      calls.push("reauthenticate-password");
      return reauthenticate(control);
    },
    setModelKillSwitch: async (enabled, control) => {
      calls.push(`kill-switch:${enabled}`);
      return setKillSwitch(enabled, control);
    },
  };
}

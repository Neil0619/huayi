import {
  hostedDeepSeekOneShotConfirmation,
  hostedDeepSeekWebOrigin,
  hostedDeepSeekWebPath,
} from "./acceptance-hosted-deepseek-one-shot.mjs";

export const candidateCommit = "1".repeat(40);
export const webCommit = "2".repeat(40);
export const ownerId = "10000000-0000-4000-8000-000000000001";
export const operationId = "20000000-0000-4000-8000-000000000002";
export const requestId = "30000000-0000-4000-8000-000000000003";
export const priceVersionId = "40000000-0000-4000-8000-000000000004";
export const cleanupId = "50000000-0000-4000-8000-000000000005";
export const observedAt = "2026-08-26T02:10:00.000Z";
export const settlementObservedAt = "2026-08-26T02:10:01.000Z";
export const postObservedAt = "2026-08-26T02:10:02.000Z";
export const nowMilliseconds = Date.parse("2026-08-26T02:10:03.000Z");
const reauthenticatedAt = "2026-08-26T02:00:01.000Z";
const leaseExpiresAt = "2026-08-26T02:15:00.000Z";

export function identity(overrides = {}) {
  return {
    idempotencyKey: "hosted-deepseek-one-shot-001",
    operationId,
    ownerId,
    requestId,
    ...overrides,
  };
}

export function approval(overrides = {}) {
  return {
    candidateCommit,
    confirmation: hostedDeepSeekOneShotConfirmation,
    maximumReservationMicroUsd: 500,
    ...overrides,
  };
}

export function deployments(overrides = {}) {
  return {
    api: {
      commit: candidateCommit,
      deploymentId: "dpl_api_candidate_001",
      state: "READY",
    },
    web: {
      commit: webCommit,
      deploymentId: "dpl_web_candidate_001",
      state: "READY",
    },
    ...overrides,
  };
}

export function ownerUsage(overrides = {}) {
  return {
    cachedInputTokens: 1_000,
    costMicroUsd: 1_000,
    inputTokens: 10_000,
    ledgerEntryCount: 10,
    outputTokens: 2_000,
    ...overrides,
  };
}

export function preSnapshot(overrides = {}) {
  return {
    authority: "hosted-read-only-snapshot",
    authorization: {
      access: "full",
      observedAt,
      operator: true,
      reauthenticatedAt,
    },
    budget: {
      availableMicroUsd: 1_000_000,
      currency: "micro-usd",
      estimatedPeakReservationMicroUsd: 400,
    },
    candidate: {
      branch: "codex/settings-configuration",
      clean: true,
      commit: candidateCommit,
      pushed: true,
      upstreamCommit: candidateCommit,
    },
    deployments: deployments(),
    killSwitchEnabled: true,
    observedAt,
    ownerUsage: ownerUsage(),
    route: {
      origin: hostedDeepSeekWebOrigin,
      path: hostedDeepSeekWebPath,
    },
    ...overrides,
  };
}

export function ledgerEntry(overrides = {}) {
  return {
    cachedInputTokens: 20,
    callOrdinal: 0,
    costMicroUsd: 17,
    id: "60000000-0000-4000-8000-000000000006",
    inputTokens: 120,
    outcome: "succeeded",
    outputTokens: 60,
    ownerId,
    priceVersionId,
    requestId,
    ...overrides,
  };
}

export function settlement(overrides = {}) {
  return {
    applicationRequestCount: 1,
    billedCallCount: 1,
    deadlineClassification: "completed-within-90-seconds",
    deployments: deployments(),
    ledgerEntries: [ledgerEntry()],
    model: "deepseek-v4-flash",
    observedAt: settlementObservedAt,
    priceVersionId,
    priceVersionSlot: "off-peak",
    request: identity(),
    reservationMicroUsd: 400,
    reservationStatus: "settled",
    settlementSource: "server-authority",
    terminalState: "completed",
    ...overrides,
  };
}

export function postSnapshot(overrides = {}) {
  return {
    applicationRequestCountDelta: 1,
    authority: "hosted-read-only-snapshot",
    deployments: deployments(),
    killSwitchEnabled: true,
    observedAt: postObservedAt,
    ownerUsage: ownerUsage({
      cachedInputTokens: 1_020,
      costMicroUsd: 1_017,
      inputTokens: 10_120,
      ledgerEntryCount: 11,
      outputTokens: 2_060,
    }),
    request: identity(),
    reservationStatus: "settled",
    terminalRequestCountDelta: 1,
    ...overrides,
  };
}

export function requestHandle(overrides = {}) {
  return { requestId, type: "analysis.started", ...overrides };
}

export function operationLease(command = approval(), overrides = {}) {
  return {
    candidateCommit: command.candidateCommit ?? candidateCommit,
    claimToken: "claim_token_001",
    idempotencyKey: identity().idempotencyKey,
    leaseExpiresAt,
    maximumReservationMicroUsd: command.maximumReservationMicroUsd ?? 500,
    operationId,
    ownerId,
    ...overrides,
  };
}

export function cleanupLease(
  command = { ...identity(), deployments: deployments() },
  overrides = {},
) {
  return {
    cleanupId,
    cleanupToken: "cleanup_token_001",
    deployments: command.deployments,
    desiredKillSwitchEnabled: true,
    idempotencyKey: command.idempotencyKey,
    leaseExpiresAt,
    operationId: command.operationId,
    ownerId: command.ownerId,
    ...overrides,
  };
}

export function unsafePreflightCases() {
  return [
    { approval: approval({ confirmation: "--wrong" }), pre: preSnapshot(), preRead: false },
    { approval: approval({ operationId }), pre: preSnapshot(), preRead: false },
    {
      approval: approval({ maximumReservationMicroUsd: 399 }),
      pre: preSnapshot(),
      preRead: true,
    },
    {
      approval: approval(),
      pre: preSnapshot({ candidate: { ...preSnapshot().candidate, clean: false } }),
      preRead: true,
    },
    {
      approval: approval(),
      pre: preSnapshot({
        deployments: deployments({ web: { ...deployments().web, commit: "not-a-sha" } }),
      }),
      preRead: true,
    },
    {
      approval: approval(),
      pre: preSnapshot({
        authorization: {
          ...preSnapshot().authorization,
          observedAt: "2026-08-26T02:10:04.000Z",
        },
      }),
      preRead: true,
    },
    {
      approval: approval(),
      pre: preSnapshot({ observedAt: "2026-08-26T02:09:32.999Z" }),
      preRead: true,
    },
    {
      approval: approval(),
      pre: preSnapshot({ killSwitchEnabled: false }),
      preRead: true,
    },
    {
      approval: approval(),
      pre: preSnapshot({
        route: { origin: hostedDeepSeekWebOrigin, path: "/v1/analyses:stream" },
      }),
      preRead: true,
    },
    {
      approval: approval(),
      pre: preSnapshot(),
      preRead: true,
      readNowMilliseconds: (() => {
        const values = [nowMilliseconds, Number.NaN];
        return () => values.shift();
      })(),
    },
  ];
}

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
} = {}) {
  let claimed = false;
  let pending = pendingCleanup;
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
      return { ...pending, cleanupToken: "recovery_cleanup_token_001" };
    },
    claimOperation: async (command) => {
      calls.push("claim-operation");
      if (claim !== undefined) return claim(command, claimed);
      if (claimed) throw new Error("operation already claimed");
      claimed = true;
      return operationLease(command);
    },
    completeCleanup: async (command) => {
      calls.push("complete-cleanup");
      const value =
        finishCleanup === undefined
          ? { cleanupId: command.cleanupId, status: "completed" }
          : await finishCleanup(command);
      if (value?.status === "completed") pending = undefined;
      return value;
    },
    completeOperation: async (command) => {
      calls.push(`complete-operation:${command.outcome}`);
      return finishOperation === undefined
        ? { operationId: command.operationId, outcome: command.outcome, status: "completed" }
        : finishOperation(command);
    },
    markDispatchAttempted: async (command) => {
      calls.push("mark-dispatch-attempted");
      return dispatch === undefined
        ? { operationId: command.operationId, status: "dispatch-attempted" }
        : dispatch(command);
    },
    pendingCleanup: () => pending,
  };
}

export function adapter({
  calls = [],
  invoke = async () => requestHandle(),
  post = postSnapshot(),
  pre = preSnapshot(),
  reconcile = settlement(),
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
    invokeCloudWebAnalysis: async (request, control) => {
      calls.push(`request:${request.origin}${request.path}`);
      return invoke(request, control);
    },
    readServerSettlement: async (handle, control) => {
      calls.push("server-settlement");
      return typeof reconcile === "function" ? reconcile(handle, control) : reconcile;
    },
    setModelKillSwitch: async (enabled, control) => {
      calls.push(`kill-switch:${enabled}`);
      return setKillSwitch(enabled, control);
    },
  };
}

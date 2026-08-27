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
export const observedAt = "2026-08-26T02:10:00.000Z";
export const settlementObservedAt = "2026-08-26T02:10:01.000Z";
export const postObservedAt = "2026-08-26T02:10:02.000Z";
export const nowMilliseconds = Date.parse("2026-08-26T02:10:03.000Z");
const reauthenticatedAt = "2026-08-26T02:00:01.000Z";
const leaseExpiresAt = "2026-08-26T02:12:03.000Z";

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
      deploymentId: "dpl_apiCandidate001",
      state: "READY",
    },
    web: {
      commit: webCommit,
      deploymentId: "dpl_webCandidate001",
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

export function authorization(overrides = {}) {
  return {
    access: "full",
    observedAt,
    operator: true,
    reauthenticatedAt,
    ...overrides,
  };
}

export function preSnapshot(overrides = {}) {
  return {
    authority: "hosted-read-only-snapshot",
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
    leaseGeneration: 1,
    maximumReservationMicroUsd: command.maximumReservationMicroUsd ?? 500,
    operationId,
    ownerId,
    ...overrides,
  };
}

export function cleanupLease(
  command = { deployments: deployments(), operationId },
  overrides = {},
) {
  return {
    armedAt: "2026-08-26T02:10:03.000Z",
    claimGeneration: 1,
    cleanupToken: "cleanup_token_001",
    deployments: command.deployments,
    desiredKillSwitchEnabled: true,
    leaseExpiresAt,
    operationId: command.operationId,
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
      claimRead: true,
      pre: preSnapshot(),
      preRead: true,
      readNowMilliseconds: (() => {
        const values = [nowMilliseconds, Number.NaN];
        return () => values.shift();
      })(),
    },
  ];
}

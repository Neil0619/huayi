import {
  hostedDeepSeekOneShotConfirmation,
  hostedDeepSeekWebOrigin,
  hostedDeepSeekWebPath,
} from "./acceptance-hosted-deepseek-one-shot.mjs";

export const candidateCommit = "1".repeat(40);
export const observedAt = "2026-08-26T02:10:00.000Z";
export const nowMilliseconds = Date.parse(observedAt);
const reauthenticatedAt = "2026-08-26T02:00:01.000Z";

export function approval(overrides = {}) {
  return {
    candidateCommit,
    confirmation: hostedDeepSeekOneShotConfirmation,
    maximumReservationMicroUsd: 500,
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
    killSwitchEnabled: true,
    route: {
      origin: hostedDeepSeekWebOrigin,
      path: hostedDeepSeekWebPath,
    },
    ...overrides,
  };
}

export function unsafePreflightCases() {
  return [
    { approval: approval({ confirmation: "--wrong" }), pre: preSnapshot(), preRead: false },
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
        authorization: {
          ...preSnapshot().authorization,
          observedAt: "2026-08-26T02:10:02.000Z",
          reauthenticatedAt: "2026-08-26T02:10:01.000Z",
        },
      }),
      preRead: true,
    },
    {
      approval: approval(),
      pre: preSnapshot({
        authorization: {
          ...preSnapshot().authorization,
          observedAt: "2026-08-26T02:10:01.000Z",
        },
      }),
      preRead: true,
    },
    {
      approval: approval(),
      pre: preSnapshot({
        authorization: {
          ...preSnapshot().authorization,
          observedAt: "2026-08-26T02:09:29.999Z",
        },
      }),
      preRead: true,
    },
    {
      approval: approval(),
      pre: preSnapshot({
        candidate: { ...preSnapshot().candidate, upstreamCommit: "2".repeat(40) },
      }),
      preRead: true,
    },
    {
      approval: approval(),
      pre: preSnapshot({
        authorization: {
          ...preSnapshot().authorization,
          reauthenticatedAt: "2026-08-26T01:54:59Z",
        },
      }),
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
      readNowMilliseconds: () => Number.NaN,
    },
  ];
}

export function settlement(overrides = {}) {
  return {
    applicationRequestCount: 1,
    billedCallCount: 1,
    costReconciled: true,
    deadlineClassification: "completed-within-90-seconds",
    dispatched: true,
    ledgerEntryCount: 1,
    ledgerReconciled: true,
    model: "deepseek-v4-flash",
    priceVersionReconciled: true,
    priceVersionSlot: "off-peak",
    reservationMicroUsd: 400,
    reservationSettled: true,
    settlementSource: "server-authority",
    terminalState: "completed",
    usageReconciled: true,
    ...overrides,
  };
}

export function postSnapshot(overrides = {}) {
  return {
    applicationRequestCountDelta: 1,
    authority: "hosted-read-only-snapshot",
    killSwitchEnabled: true,
    ledgerEntryCountDelta: 1,
    reservationStatus: "settled",
    terminalRequestCountDelta: 1,
    ...overrides,
  };
}

export function adapter({
  calls = [],
  invoke = async () => ({ opaque: "request-handle" }),
  post = postSnapshot(),
  pre = preSnapshot(),
  reconcile = settlement(),
  setKillSwitch = async () => undefined,
} = {}) {
  return {
    capturePostSnapshot: async () => {
      calls.push("post-snapshot");
      return typeof post === "function" ? post() : post;
    },
    capturePreSnapshot: async () => {
      calls.push("pre-snapshot");
      return typeof pre === "function" ? pre() : pre;
    },
    invokeCloudWebAnalysis: async (route, control) => {
      calls.push(`request:${route.origin}${route.path}`);
      return invoke(route, control);
    },
    readServerSettlement: async (handle, control) => {
      calls.push("server-settlement");
      return typeof reconcile === "function" ? reconcile(handle, control) : reconcile;
    },
    setModelKillSwitch: async (enabled) => {
      calls.push(`kill-switch:${enabled}`);
      return setKillSwitch(enabled);
    },
  };
}

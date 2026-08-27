import assert from "node:assert/strict";
import test from "node:test";

import { createHostedDeepSeekOneShotExecutor } from "./acceptance-hosted-deepseek-one-shot.mjs";
import {
  approval,
  cleanupLease,
  deployments,
  identity,
  nowMilliseconds,
  observedAt,
  operationLease,
  ownerUsage,
  postSnapshot,
  preSnapshot,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";
import {
  adapter,
  operationLifecycle,
} from "./acceptance-hosted-deepseek-one-shot-fake-adapters.mjs";
import { hostedDeepSeekPayloadDigest } from "./acceptance-hosted-deepseek-one-shot.mjs";

const failurePattern = /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;

function orchestrate(options) {
  const { approval: executionApproval, ...dependencies } = {
    readNowMilliseconds: () => nowMilliseconds,
    ...options,
  };
  return createHostedDeepSeekOneShotExecutor(dependencies).execute(executionApproval);
}

test("one approval is atomically consumed before concurrent callers can dispatch twice", async () => {
  const calls = [];
  const lifecycle = operationLifecycle({ calls });

  const results = await Promise.allSettled([
    orchestrate({ adapter: adapter({ calls }), approval: approval(), lifecycle }),
    orchestrate({ adapter: adapter({ calls }), approval: approval(), lifecycle }),
  ]);

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(calls.filter((call) => call === "claim-operation").length, 2);
  assert.equal(calls.filter((call) => call === "pre-snapshot").length, 2);
  assert.equal(calls.filter((call) => call.startsWith("request:")).length, 1);
});

test("the orchestrator deadline wins even when the application adapter ignores abort", async () => {
  let applicationSignal;
  let fireDeadline;
  await assert.rejects(
    orchestrate({
      adapter: adapter({
        invoke: async (_request, control) => {
          applicationSignal = control.signal;
          queueMicrotask(fireDeadline);
          return new Promise(() => undefined);
        },
      }),
      approval: approval(),
      clearTimeout_: () => undefined,
      lifecycle: operationLifecycle(),
      setTimeout_: (callback, milliseconds) => {
        if (milliseconds === 90_000) fireDeadline = callback;
        return 1;
      },
    }),
    failurePattern,
  );
  assert.equal(applicationSignal.aborted, true);
});

test("preflight owns an absolute deadline before any authority mutation", async () => {
  let fireDeadline;
  let preflightControl;
  const calls = [];
  await assert.rejects(
    orchestrate({
      adapter: adapter({
        calls,
        pre: async (control) => {
          preflightControl = control;
          if (control === undefined) throw new Error("missing preflight control");
          queueMicrotask(fireDeadline);
          return new Promise(() => undefined);
        },
      }),
      approval: approval(),
      clearTimeout_: () => undefined,
      lifecycle: operationLifecycle({ calls }),
      setTimeout_: (callback, milliseconds) => {
        if (milliseconds === 10_000) fireDeadline = callback;
        return 1;
      },
    }),
    failurePattern,
  );
  assert.equal(preflightControl.signal.aborted, true);
  assert.equal(calls.includes("claim-operation"), false);
  assert.equal(calls.includes("login-password"), false);
});

test("a deadline between stages prevents the next adapter stage from starting", async () => {
  const calls = [];
  let fireDeadline;
  await assert.rejects(
    orchestrate({
      adapter: adapter({
        calls,
        setKillSwitch: async (enabled) => {
          if (!enabled) queueMicrotask(fireDeadline);
        },
      }),
      approval: approval(),
      clearTimeout_: () => undefined,
      lifecycle: operationLifecycle(),
      setTimeout_: (callback, milliseconds) => {
        if (milliseconds === 90_000) fireDeadline = callback;
        return 1;
      },
    }),
    failurePattern,
  );
  assert.equal(
    calls.some((call) => call.startsWith("request:")),
    false,
  );
  assert.deepEqual(calls.slice(-3), ["kill-switch:true", "post-snapshot", "logout"]);
});

test("legacy unbound evidence and an undated post snapshot cannot prove acceptance", async () => {
  const currentPre = preSnapshot();
  const legacyPre = {
    authority: currentPre.authority,
    budget: currentPre.budget,
    candidate: currentPre.candidate,
    killSwitchEnabled: currentPre.killSwitchEnabled,
    route: currentPre.route,
  };
  const currentPost = postSnapshot();
  const legacyPost = {
    applicationRequestCountDelta: currentPost.applicationRequestCountDelta,
    authority: currentPost.authority,
    killSwitchEnabled: currentPost.killSwitchEnabled,
    ledgerEntryCountDelta: 1,
    reservationStatus: currentPost.reservationStatus,
    terminalRequestCountDelta: currentPost.terminalRequestCountDelta,
  };

  await assert.rejects(
    orchestrate({
      adapter: adapter({ post: legacyPost, pre: legacyPre }),
      approval: approval(),
      lifecycle: operationLifecycle(),
    }),
    failurePattern,
  );
});

test("failed local restoration leaves a durable lease for cleanup-only recovery", async () => {
  const lifecycleCalls = [];
  const lifecycle = operationLifecycle({ calls: lifecycleCalls });
  await assert.rejects(
    orchestrate({
      adapter: adapter({
        setKillSwitch: async (enabled) => {
          if (enabled) throw new Error("private local restore failure");
        },
      }),
      approval: approval(),
      lifecycle,
    }),
    failurePattern,
  );
  assert.notEqual(lifecycle.pendingCleanup(), undefined);
  assert.match(lifecycleCalls.at(-1), /failed-cleanup-pending/u);

  const recoveryCalls = [];
  const recoveryExecutor = createHostedDeepSeekOneShotExecutor({
    adapter: adapter({ calls: recoveryCalls }),
    lifecycle,
    readNowMilliseconds: () => nowMilliseconds,
  });
  const result = await recoveryExecutor.recover();
  assert.deepEqual(result, {
    killSwitchRestored: true,
    outcome: "restored",
  });
  assert.deepEqual(recoveryCalls, [
    "login-password",
    "reauthenticate-password",
    "operator-readback",
    "kill-switch:true",
    "post-snapshot",
    "logout",
  ]);
  assert.equal(lifecycle.pendingCleanup(), undefined);
  await assert.rejects(recoveryExecutor.recover(), failurePattern);
});

test("a restarted process reconciles dispatch-before-bind exactly once and never POSTs again", async () => {
  const calls = [];
  const restartedOperationLease = operationLease(approval(), {
    claimToken: "restarted_operation_token_001",
    leaseGeneration: 2,
  });
  const recoveryClaim = {
    cleanupLease: {
      ...cleanupLease(),
      cleanupToken: "restarted_cleanup_token_001",
      claimGeneration: 2,
    },
    dispatchRecovery: {
      dispatchAttempted: true,
      idempotencyKey: restartedOperationLease.idempotencyKey,
      idempotencyVerifier: "e".repeat(64),
      observedAt,
      operationLease: restartedOperationLease,
      payloadDigest: hostedDeepSeekPayloadDigest,
      requestId: null,
      settlementRecorded: false,
    },
  };
  const lifecycle = operationLifecycle({
    calls,
    claimCleanup: () => recoveryClaim,
    finishCleanup: (command) => ({
      operationId: command.operationId,
      operationState: "running",
      status: "completed",
    }),
    pendingCleanup: cleanupLease(),
  });
  const restarted = createHostedDeepSeekOneShotExecutor({
    adapter: adapter({ calls }),
    lifecycle,
    readNowMilliseconds: () => nowMilliseconds,
  });

  const recovered = await restarted.recover();
  assert.deepEqual(recovered, {
    killSwitchRestored: true,
    outcome: "accepted",
  });
  assert.equal(calls.filter((call) => call.startsWith("request:")).length, 0);
  assert.equal(calls.filter((call) => call === "reconcile-request").length, 1);
  assert.equal(calls.filter((call) => call === "bind-request").length, 1);
  assert.equal(calls.filter((call) => call === "record-settlement").length, 1);
});

test("recovery evidence timeout still reaches cleanup and logout", async () => {
  const calls = [];
  let evidenceControl;
  let fireDeadline;
  const restartedOperationLease = operationLease(approval(), {
    claimToken: "restarted_operation_token_001",
    leaseGeneration: 2,
  });
  const lifecycle = operationLifecycle({
    calls,
    claimCleanup: () => ({
      cleanupLease: {
        ...cleanupLease(),
        cleanupToken: "restarted_cleanup_token_001",
        claimGeneration: 2,
      },
      dispatchRecovery: {
        dispatchAttempted: true,
        idempotencyKey: restartedOperationLease.idempotencyKey,
        idempotencyVerifier: "e".repeat(64),
        observedAt,
        operationLease: restartedOperationLease,
        payloadDigest: hostedDeepSeekPayloadDigest,
        requestId: null,
        settlementRecorded: false,
      },
    }),
    pendingCleanup: cleanupLease(),
  });
  const applicationAdapter = adapter({ calls });
  applicationAdapter.reconcileDispatchedRequest = async (_request, control) => {
    calls.push("reconcile-request");
    evidenceControl = control;
    if (control === undefined) throw new Error("missing recovery evidence control");
    queueMicrotask(fireDeadline);
    return new Promise(() => undefined);
  };
  const restarted = createHostedDeepSeekOneShotExecutor({
    adapter: applicationAdapter,
    clearTimeout_: () => undefined,
    lifecycle,
    readNowMilliseconds: () => nowMilliseconds,
    setTimeout_: (callback, milliseconds) => {
      if (milliseconds === 20_000) fireDeadline = callback;
      return 1;
    },
  });

  await assert.rejects(restarted.recover(), failurePattern);
  assert.equal(evidenceControl.signal.aborted, true);
  assert.equal(calls.includes("kill-switch:true"), true);
  assert.equal(calls.includes("post-snapshot"), true);
  assert.equal(calls.includes("logout"), true);
});

test("completed cleanup crash recovery finalizes from authority with zero external calls", async () => {
  const adapterCalls = [];
  const lifecycleCalls = [];
  const restartedOperationLease = operationLease(approval(), {
    claimToken: "restarted_operation_token_001",
    leaseGeneration: 2,
  });
  const lifecycle = operationLifecycle({
    calls: lifecycleCalls,
    claimCleanup: () => ({
      cleanupAlreadyCompleted: true,
      cleanupLease: {
        ...cleanupLease(),
        cleanupToken: "restarted_cleanup_token_001",
        claimGeneration: 2,
      },
      dispatchRecovery: {
        dispatchAttempted: true,
        idempotencyKey: restartedOperationLease.idempotencyKey,
        idempotencyVerifier: "e".repeat(64),
        observedAt,
        operationLease: restartedOperationLease,
        payloadDigest: hostedDeepSeekPayloadDigest,
        requestId: identity().requestId,
        settlementRecorded: true,
      },
    }),
    pendingCleanup: cleanupLease(),
  });
  const restarted = createHostedDeepSeekOneShotExecutor({
    adapter: adapter({ calls: adapterCalls }),
    lifecycle,
    readNowMilliseconds: () => nowMilliseconds,
  });

  assert.deepEqual(await restarted.recover(), {
    killSwitchRestored: true,
    outcome: "accepted",
  });
  assert.deepEqual(adapterCalls, []);
  assert.deepEqual(lifecycleCalls, ["claim-cleanup", "complete-operation:accepted"]);
});

test("post freshness is independently sampled instead of inherited from preflight", async () => {
  await assert.rejects(
    orchestrate({
      adapter: adapter({
        post: postSnapshot({ observedAt }),
      }),
      approval: approval(),
      lifecycle: operationLifecycle(),
      readNowMilliseconds: (() => {
        const instants = [
          nowMilliseconds,
          nowMilliseconds,
          nowMilliseconds,
          nowMilliseconds + 30_001,
        ];
        return () => instants.shift();
      })(),
    }),
    failurePattern,
  );
});

test("a post-evidence clock failure still logs out before durable terminalization", async () => {
  const calls = [];
  let readsAfterPostSnapshot = 0;

  await assert.rejects(
    orchestrate({
      adapter: adapter({
        calls,
        destroy: () => calls.push("destroy-session"),
      }),
      approval: approval(),
      lifecycle: operationLifecycle({ calls }),
      readNowMilliseconds: () => {
        if (calls.at(-1) === "post-snapshot") {
          readsAfterPostSnapshot += 1;
          if (readsAfterPostSnapshot === 2) throw new Error("private clock failure");
        }
        return nowMilliseconds;
      },
    }),
    failurePattern,
  );

  assert.deepEqual(calls.slice(-4), [
    "logout",
    "destroy-session",
    "complete-cleanup",
    "complete-operation:failed",
  ]);
});

test("fresh post evidence must match restoration, identity, deployments, and usage delta", async () => {
  const unsafePosts = [
    postSnapshot({ applicationRequestCountDelta: 0 }),
    postSnapshot({ killSwitchEnabled: false }),
    postSnapshot({ observedAt: "2026-08-26T02:09:32.999Z" }),
    postSnapshot({ request: identity({ requestId: "90000000-0000-4000-8000-000000000009" }) }),
    postSnapshot({
      deployments: deployments({ web: { ...deployments().web, deploymentId: "dpl_other_web" } }),
    }),
    postSnapshot({ ownerUsage: ownerUsage({ ledgerEntryCount: 12 }) }),
    postSnapshot({
      ownerUsage: ownerUsage({
        cachedInputTokens: 1_020,
        costMicroUsd: 1_018,
        inputTokens: 10_120,
        ledgerEntryCount: 11,
        outputTokens: 2_060,
      }),
    }),
    postSnapshot({ reservationStatus: "active" }),
    postSnapshot({ terminalRequestCountDelta: 0 }),
  ];

  for (const post of unsafePosts) {
    const calls = [];
    await assert.rejects(
      orchestrate({
        adapter: adapter({ calls, post }),
        approval: approval(),
        lifecycle: operationLifecycle({ calls }),
      }),
      failurePattern,
    );
    assert.equal(calls.filter((call) => call.startsWith("request:")).length, 1);
    assert.match(calls.at(-1), /^complete-operation:failed(?:-cleanup-pending)?$/u);
  }
});

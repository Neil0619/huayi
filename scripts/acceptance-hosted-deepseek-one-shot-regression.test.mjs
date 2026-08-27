import assert from "node:assert/strict";
import test from "node:test";

import { createHostedDeepSeekOneShotExecutor } from "./acceptance-hosted-deepseek-one-shot.mjs";
import {
  approval,
  deployments,
  identity,
  nowMilliseconds,
  observedAt,
  ownerUsage,
  postSnapshot,
  preSnapshot,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";
import {
  adapter,
  operationLifecycle,
} from "./acceptance-hosted-deepseek-one-shot-fake-adapters.mjs";

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

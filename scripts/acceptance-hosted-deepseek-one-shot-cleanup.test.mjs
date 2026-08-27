import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  createHostedDeepSeekOneShotExecutor,
  hostedDeepSeekApplicationBudgetMilliseconds,
  hostedDeepSeekCleanupBudgetMilliseconds,
} from "./acceptance-hosted-deepseek-one-shot.mjs";
import {
  approval,
  cleanupLease,
  nowMilliseconds,
  operationLease,
  postSnapshot,
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

test("an invalid operation receipt is never promoted into an unsafe completion", async () => {
  const adapterCalls = [];
  const lifecycleCalls = [];
  await assert.rejects(
    orchestrate({
      adapter: adapter({ calls: adapterCalls }),
      approval: approval(),
      lifecycle: operationLifecycle({
        calls: lifecycleCalls,
        claim: (command) => operationLease(command, { claimToken: "bad" }),
      }),
    }),
    failurePattern,
  );
  assert.deepEqual(adapterCalls, ["pre-snapshot"]);
  assert.deepEqual(lifecycleCalls, ["claim-operation"]);
});

test("an invalid cleanup receipt cannot drive a kill-switch mutation or cleanup completion", async () => {
  const adapterCalls = [];
  const lifecycleCalls = [];
  await assert.rejects(
    orchestrate({
      adapter: adapter({ calls: adapterCalls }),
      approval: approval(),
      lifecycle: operationLifecycle({
        arm: (command) =>
          cleanupLease(command, {
            cleanupToken: "bad",
            desiredKillSwitchEnabled: false,
          }),
        calls: lifecycleCalls,
      }),
    }),
    failurePattern,
  );
  assert.equal(
    adapterCalls.some((call) => call.startsWith("kill-switch:")),
    false,
  );
  assert.equal(lifecycleCalls.includes("complete-cleanup"), false);
  assert.match(lifecycleCalls.at(-1), /failed-cleanup-pending/u);
});

for (const [article, leaseClass, leaseExpiresAt, armedAt] of [
  ["a", "short", "2026-08-26T02:11:35.000Z", "2026-08-26T02:10:03.000Z"],
  ["an", "overlong", "2026-08-26T02:12:03.000Z", "2026-08-26T02:10:02.999Z"],
]) {
  test(`${article} ${leaseClass} post-arm operation lease closes valid cleanup before logout`, async () => {
    const adapterCalls = [];
    const lifecycleCalls = [];
    const lifecycle = operationLifecycle({
      arm: (command) => cleanupLease(command, { armedAt }),
      calls: lifecycleCalls,
      claim: (command) => operationLease(command, { leaseExpiresAt }),
      finishCleanup: (command) => ({
        operationId: command.operationId,
        operationState: "running",
        status: "completed",
      }),
    });

    await assert.rejects(
      orchestrate({ adapter: adapter({ calls: adapterCalls }), approval: approval(), lifecycle }),
      failurePattern,
    );

    assert.deepEqual(adapterCalls.slice(-3), ["kill-switch:true", "post-snapshot", "logout"]);
    assert.equal(lifecycle.pendingCleanup(), undefined);
    assert.deepEqual(lifecycleCalls.slice(-2), ["complete-cleanup", "complete-operation:failed"]);
  });
}

test("execute rejects a future server armedAt before application mutation", async () => {
  const calls = [];
  await assert.rejects(
    orchestrate({
      adapter: adapter({ calls }),
      approval: approval(),
      lifecycle: operationLifecycle({
        arm: (command) => cleanupLease(command, { armedAt: "2026-08-26T02:10:03.001Z" }),
        calls,
      }),
    }),
    failurePattern,
  );
  assert.equal(calls.includes("kill-switch:false"), false);
  assert.equal(
    calls.some((call) => call.startsWith("request:")),
    false,
  );
  assert.equal(calls.filter((call) => call === "logout").length, 1);
});

test("recovery rejects a future server armedAt before login", async () => {
  const calls = [];
  const pendingCleanup = cleanupLease();
  const executor = createHostedDeepSeekOneShotExecutor({
    adapter: adapter({ calls }),
    lifecycle: operationLifecycle({
      calls,
      claimCleanup: () => ({
        ...pendingCleanup,
        armedAt: "2026-08-26T02:10:03.001Z",
        cleanupToken: "recovery_cleanup_token_001",
      }),
      pendingCleanup,
    }),
    readNowMilliseconds: () => nowMilliseconds,
  });

  await assert.rejects(executor.recover(), failurePattern);
  assert.deepEqual(calls, ["claim-cleanup"]);
});

for (const shortLease of ["operation", "cleanup"]) {
  test(`a slow cleanup handoff rejects a short ${shortLease} lease before application mutation`, async () => {
    const adapterCalls = [];
    let now = nowMilliseconds;
    await assert.rejects(
      orchestrate({
        adapter: adapter({ calls: adapterCalls }),
        approval: approval(),
        lifecycle: operationLifecycle({
          arm: (command) => {
            now = Date.parse("2026-08-26T02:14:59.000Z");
            return cleanupLease(command, {
              leaseExpiresAt:
                shortLease === "cleanup" ? "2026-08-26T02:15:00.000Z" : "2026-08-26T02:20:00.000Z",
            });
          },
          claim: (command) =>
            operationLease(command, {
              leaseExpiresAt:
                shortLease === "operation"
                  ? "2026-08-26T02:15:00.000Z"
                  : "2026-08-26T02:20:00.000Z",
            }),
        }),
        readNowMilliseconds: () => now,
      }),
      failurePattern,
    );
    assert.equal(adapterCalls.includes("kill-switch:false"), false);
    assert.equal(
      adapterCalls.some((call) => call.startsWith("request:")),
      false,
    );
  });
}

test("opaque cleanup operation ids fail before the durable lifecycle is called", async () => {
  const lifecycleCalls = [];
  const executor = createHostedDeepSeekOneShotExecutor({
    adapter: adapter(),
    lifecycle: operationLifecycle({ calls: lifecycleCalls }),
    readNowMilliseconds: () => nowMilliseconds,
  });
  await assert.rejects(executor.recover({ operationId: "not-a-uuid" }), failurePattern);
  assert.deepEqual(lifecycleCalls, []);
});

for (const hangingStage of ["restore", "post-snapshot"]) {
  test(`local cleanup ${hangingStage} cannot outlive its bounded attempt`, async () => {
    const adapterCalls = [];
    const lifecycleCalls = [];
    let fireCleanupDeadline;
    let cleanupControl;
    const result = await Promise.race([
      orchestrate({
        adapter: adapter({
          calls: adapterCalls,
          post:
            hangingStage === "post-snapshot"
              ? async (control) => {
                  cleanupControl = control;
                  queueMicrotask(fireCleanupDeadline);
                  return new Promise(() => undefined);
                }
              : postSnapshot(),
          setKillSwitch: async (enabled, control) => {
            if (enabled && hangingStage === "restore") {
              cleanupControl = control;
              queueMicrotask(fireCleanupDeadline);
              return new Promise(() => undefined);
            }
          },
        }),
        approval: approval(),
        clearTimeout_: () => undefined,
        lifecycle: operationLifecycle({ calls: lifecycleCalls }),
        setTimeout_: (callback, milliseconds) => {
          if (milliseconds === hostedDeepSeekCleanupBudgetMilliseconds) {
            fireCleanupDeadline = callback;
          }
          return milliseconds;
        },
      }).then(
        () => "fulfilled",
        () => "rejected",
      ),
      delay(30, "hung"),
    ]);
    assert.equal(result, "rejected");
    assert.equal(cleanupControl.cleanupBudgetMilliseconds, 10_000);
    assert.equal(
      cleanupControl.deadlineAt,
      nowMilliseconds + hostedDeepSeekCleanupBudgetMilliseconds,
    );
    assert.equal(cleanupControl.signal.aborted, true);
    assert.equal(adapterCalls.includes("kill-switch:true"), true);
    assert.equal(adapterCalls.includes("post-snapshot"), hangingStage === "post-snapshot");
    assert.equal(lifecycleCalls.includes("complete-cleanup"), false);
    assert.match(lifecycleCalls.at(-1), /failed-cleanup-pending/u);
  });
}

test("cleanup-only recovery is bounded and never reports a hanging restore as complete", async () => {
  const adapterCalls = [];
  const lifecycleCalls = [];
  const lifecycle = operationLifecycle({
    calls: lifecycleCalls,
    pendingCleanup: cleanupLease(),
  });
  let cleanupControl;
  let fireCleanupDeadline;
  const executor = createHostedDeepSeekOneShotExecutor({
    adapter: adapter({
      calls: adapterCalls,
      setKillSwitch: async (enabled, control) => {
        if (enabled) {
          cleanupControl = control;
          queueMicrotask(fireCleanupDeadline);
          return new Promise(() => undefined);
        }
      },
    }),
    clearTimeout_: () => undefined,
    lifecycle,
    readNowMilliseconds: () => nowMilliseconds,
    setTimeout_: (callback, milliseconds) => {
      assert.equal(milliseconds, hostedDeepSeekCleanupBudgetMilliseconds);
      fireCleanupDeadline = callback;
      return 1;
    },
  });
  const result = await Promise.race([
    executor.recover().then(
      () => "fulfilled",
      () => "rejected",
    ),
    delay(30, "hung"),
  ]);
  assert.equal(result, "rejected");
  assert.equal(cleanupControl.cleanupBudgetMilliseconds, 10_000);
  assert.equal(cleanupControl.signal.aborted, true);
  assert.deepEqual(adapterCalls, [
    "login-password",
    "reauthenticate-password",
    "operator-readback",
    "kill-switch:true",
    "logout",
  ]);
  assert.notEqual(lifecycle.pendingCleanup(), undefined);
  assert.equal(lifecycleCalls.includes("complete-cleanup"), false);
});

test("application and cleanup deadlines remain independently budgeted", () => {
  assert.equal(hostedDeepSeekApplicationBudgetMilliseconds, 90_000);
  assert.equal(hostedDeepSeekCleanupBudgetMilliseconds, 10_000);
});

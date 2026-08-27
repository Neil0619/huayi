import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  createHostedDeepSeekOneShotExecutor,
  hostedDeepSeekApplicationBudgetMilliseconds,
  hostedDeepSeekCleanupBudgetMilliseconds,
  hostedDeepSeekLogoutBudgetMilliseconds,
  hostedDeepSeekOperationLeaseMaximumAfterArmMilliseconds,
  hostedDeepSeekSessionBudgetMilliseconds,
} from "./acceptance-hosted-deepseek-one-shot.mjs";
import {
  approval,
  cleanupLease,
  nowMilliseconds,
  operationLease,
  preSnapshot,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";
import {
  adapter,
  operationLifecycle,
} from "./acceptance-hosted-deepseek-one-shot-fake-adapters.mjs";

const failurePattern = /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;
const operatorAuthorization = Object.freeze({
  access: "full",
  observedAt: "2026-08-26T02:10:00.000Z",
  operator: true,
  reauthenticatedAt: "2026-08-26T02:00:01.000Z",
});

function sessionFreePreSnapshot(overrides = {}) {
  return preSnapshot(overrides);
}

function sessionAwareAdapter({
  calls = [],
  invoke,
  login = async () => undefined,
  logout = async () => undefined,
  operator = operatorAuthorization,
  post,
  pre = sessionFreePreSnapshot(),
  reauthenticate = async () => undefined,
  setKillSwitch,
} = {}) {
  let sessionGeneration = "none";
  const applicationAdapter = adapter({ calls, invoke, post, pre, setKillSwitch });
  const invokeCloudWebAnalysis = applicationAdapter.invokeCloudWebAnalysis;
  const reconcileDispatchedRequest = applicationAdapter.reconcileDispatchedRequest;
  const setModelKillSwitch = applicationAdapter.setModelKillSwitch;
  return {
    ...applicationAdapter,
    invokeCloudWebAnalysis: async (...arguments_) => {
      assert.equal(sessionGeneration, "reauthenticated");
      return invokeCloudWebAnalysis(...arguments_);
    },
    loginPassword: async (control) => {
      calls.push("login-password");
      await login(control);
      sessionGeneration = "login";
    },
    logout: async (control) => {
      calls.push("logout");
      assert.ok(["login", "reauthenticated"].includes(sessionGeneration));
      await logout(control);
      sessionGeneration = "closed";
    },
    readOperatorAuthorization: async (control) => {
      calls.push("operator-readback");
      assert.equal(sessionGeneration, "reauthenticated");
      return typeof operator === "function" ? operator(control) : operator;
    },
    reauthenticatePassword: async (control) => {
      calls.push("reauthenticate-password");
      assert.equal(sessionGeneration, "login");
      await reauthenticate(control);
      sessionGeneration = "reauthenticated";
    },
    reconcileDispatchedRequest: async (...arguments_) => {
      assert.equal(sessionGeneration, "reauthenticated");
      return reconcileDispatchedRequest(...arguments_);
    },
    setModelKillSwitch: async (...arguments_) => {
      assert.equal(sessionGeneration, "reauthenticated");
      return setModelKillSwitch(...arguments_);
    },
  };
}

function createExecutor({ applicationAdapter, clearTimeout_, lifecycle, setTimeout_, signal }) {
  return createHostedDeepSeekOneShotExecutor({
    adapter: applicationAdapter,
    clearTimeout_,
    lifecycle,
    readNowMilliseconds: () => nowMilliseconds,
    setTimeout_,
    signal,
  });
}

test("Phase C claims session-free evidence before login and terminalizes after cleanup then logout", async () => {
  const calls = [];
  const sessionControls = [];
  let logoutControl;
  const applicationAdapter = sessionAwareAdapter({
    calls,
    login: async (control) => sessionControls.push(control),
    logout: async (control) => {
      logoutControl = control;
    },
    operator: (control) => {
      sessionControls.push(control);
      return operatorAuthorization;
    },
    reauthenticate: async (control) => sessionControls.push(control),
  });
  const result = await createExecutor({
    applicationAdapter,
    lifecycle: operationLifecycle({ calls }),
  }).execute(approval());

  assert.deepEqual(result, { killSwitchRestored: true, outcome: "accepted" });
  assert.deepEqual(calls, [
    "pre-snapshot",
    "claim-operation",
    "login-password",
    "reauthenticate-password",
    "operator-readback",
    "arm-cleanup",
    "kill-switch:false",
    "mark-dispatch-attempted",
    "request:https://app.acceptance.seen-said.cn/v1/analyses:stream",
    "bind-request",
    "server-settlement",
    "kill-switch:true",
    "post-snapshot",
    "logout",
    "complete-cleanup",
    "complete-operation:accepted",
  ]);
  assert.equal(sessionControls.length, 3);
  assert.equal(sessionControls[1], sessionControls[0]);
  assert.equal(sessionControls[2], sessionControls[0]);
  for (const control of sessionControls) {
    assert.deepEqual(Object.keys(control).sort(), [
      "deadlineAt",
      "sessionBudgetMilliseconds",
      "signal",
    ]);
    assert.equal(control.sessionBudgetMilliseconds, 10_000);
    assert.equal(control.deadlineAt, nowMilliseconds + 10_000);
  }
  assert.deepEqual(Object.keys(logoutControl).sort(), [
    "deadlineAt",
    "logoutBudgetMilliseconds",
    "signal",
  ]);
  assert.equal(logoutControl.logoutBudgetMilliseconds, 10_000);
  assert.equal(logoutControl.deadlineAt, nowMilliseconds + 10_000);
});

test("Phase C never logs in before both session-free preflight and operation claim are valid", async () => {
  for (const { claim, pre } of [
    { pre: sessionFreePreSnapshot({ killSwitchEnabled: false }) },
    {
      claim: (command) => operationLease(command, { claimToken: "bad" }),
      pre: sessionFreePreSnapshot(),
    },
  ]) {
    const calls = [];
    const lifecycle = operationLifecycle({ calls, claim });
    const executor = createExecutor({
      applicationAdapter: sessionAwareAdapter({ calls, pre }),
      lifecycle,
    });

    await assert.rejects(executor.execute(approval()), failurePattern);
    assert.equal(calls.includes("login-password"), false);
    assert.equal(calls.includes("reauthenticate-password"), false);
    assert.equal(calls.includes("logout"), false);
  }
});

test("Phase C logs out exactly once after login when reauthentication fails", async () => {
  const calls = [];
  const applicationAdapter = sessionAwareAdapter({
    calls,
    logout: async () => undefined,
    reauthenticate: async () => {
      throw new Error("private password failure");
    },
  });
  await assert.rejects(
    createExecutor({
      applicationAdapter,
      lifecycle: operationLifecycle({ calls }),
    }).execute(approval()),
    failurePattern,
  );

  assert.equal(calls.filter((call) => call === "login-password").length, 1);
  assert.equal(calls.filter((call) => call === "reauthenticate-password").length, 1);
  assert.equal(calls.filter((call) => call === "logout").length, 1);
  assert.equal(calls.includes("arm-cleanup"), false);
  assert.ok(calls.indexOf("logout") < calls.indexOf("complete-operation:failed"));
});

test("Phase C application abort cannot suppress independent cleanup or logout", async () => {
  const calls = [];
  const applicationAbort = new AbortController();
  let logoutControl;
  const applicationAdapter = sessionAwareAdapter({
    calls,
    invoke: async () => {
      applicationAbort.abort();
      throw new Error("private application abort");
    },
    logout: async (control) => {
      logoutControl = control;
    },
  });

  await assert.rejects(
    createExecutor({
      applicationAdapter,
      lifecycle: operationLifecycle({ calls }),
      signal: applicationAbort.signal,
    }).execute(approval()),
    failurePattern,
  );

  assert.deepEqual(calls.slice(-5), [
    "kill-switch:true",
    "post-snapshot",
    "logout",
    "complete-cleanup",
    "complete-operation:failed",
  ]);
  assert.equal(logoutControl.signal.aborted, false);
  assert.notEqual(logoutControl.signal, applicationAbort.signal);
  assert.equal(calls.filter((call) => call === "logout").length, 1);
});

test("Phase C logout failure stays fixed while durable cleanup still completes", async () => {
  const calls = [];
  const privateDetail = "private logout transport detail";
  const applicationAdapter = sessionAwareAdapter({
    calls,
    logout: async () => {
      throw new Error(privateDetail);
    },
  });
  let message = "";
  try {
    await createExecutor({
      applicationAdapter,
      lifecycle: operationLifecycle({ calls }),
    }).execute(approval());
    assert.fail("Expected logout failure.");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assert.equal(message, "Hosted Cloud Web DeepSeek one-shot failed closed.");
  assert.equal(message.includes(privateDetail), false);
  assert.deepEqual(calls.slice(-5), [
    "kill-switch:true",
    "post-snapshot",
    "logout",
    "complete-cleanup",
    "complete-operation:failed",
  ]);
});

test("Phase C bounds ignored logout independently and terminalizes only after its outcome", async () => {
  const calls = [];
  let fireLogoutDeadline;
  let logoutControl;
  const applicationAdapter = sessionAwareAdapter({
    calls,
    logout: async (control) => {
      logoutControl = control;
      queueMicrotask(fireLogoutDeadline);
      return new Promise(() => undefined);
    },
  });
  const result = await Promise.race([
    createExecutor({
      applicationAdapter,
      clearTimeout_: () => undefined,
      lifecycle: operationLifecycle({ calls }),
      setTimeout_: (callback, milliseconds) => {
        if (milliseconds === 10_000 && calls.includes("post-snapshot")) {
          fireLogoutDeadline = callback;
        }
        return 1;
      },
    })
      .execute(approval())
      .then(
        () => "fulfilled",
        () => "rejected",
      ),
    delay(30, "hung"),
  ]);

  assert.equal(result, "rejected");
  assert.equal(logoutControl.logoutBudgetMilliseconds, 10_000);
  assert.equal(logoutControl.signal.aborted, true);
  assert.deepEqual(calls.slice(-3), ["logout", "complete-cleanup", "complete-operation:failed"]);
});

test("Phase C recovery claims before login, then reauthenticates, restores, logs out, and terminalizes", async () => {
  const calls = [];
  const lifecycle = operationLifecycle({ calls, pendingCleanup: cleanupLease() });
  const executor = createExecutor({
    applicationAdapter: sessionAwareAdapter({ calls }),
    lifecycle,
  });

  assert.deepEqual(await executor.recover(), {
    killSwitchRestored: true,
    outcome: "restored",
  });
  assert.deepEqual(calls, [
    "claim-cleanup",
    "login-password",
    "reauthenticate-password",
    "operator-readback",
    "kill-switch:true",
    "post-snapshot",
    "logout",
    "complete-cleanup",
  ]);

  const invalidCalls = [];
  const invalidExecutor = createExecutor({
    applicationAdapter: sessionAwareAdapter({ calls: invalidCalls }),
    lifecycle: operationLifecycle({ calls: invalidCalls, pendingCleanup: null }),
  });
  await assert.rejects(invalidExecutor.recover(), failurePattern);
  assert.deepEqual(invalidCalls, ["claim-cleanup"]);

  const shortLeaseCalls = [];
  const shortLeaseExecutor = createExecutor({
    applicationAdapter: sessionAwareAdapter({ calls: shortLeaseCalls }),
    lifecycle: operationLifecycle({
      calls: shortLeaseCalls,
      claimCleanup: () => cleanupLease(undefined, { leaseExpiresAt: "2026-08-26T02:10:33.000Z" }),
      pendingCleanup: cleanupLease(),
    }),
  });
  await assert.rejects(shortLeaseExecutor.recover(), failurePattern);
  assert.deepEqual(shortLeaseCalls, ["claim-cleanup"]);
});

test("Phase C recovery preserves durable cleanup even when its logout fails", async () => {
  const calls = [];
  const executor = createExecutor({
    applicationAdapter: sessionAwareAdapter({
      calls,
      logout: async () => {
        throw new Error("private recovery logout failure");
      },
    }),
    lifecycle: operationLifecycle({ calls, pendingCleanup: cleanupLease() }),
  });

  await assert.rejects(executor.recover(), failurePattern);
  assert.deepEqual(calls.slice(-4), [
    "kill-switch:true",
    "post-snapshot",
    "logout",
    "complete-cleanup",
  ]);
});

test("Phase C fixes one shared session envelope and independent application/cleanup/logout bounds", () => {
  assert.equal(hostedDeepSeekSessionBudgetMilliseconds, 10_000);
  assert.equal(hostedDeepSeekApplicationBudgetMilliseconds, 90_000);
  assert.equal(hostedDeepSeekCleanupBudgetMilliseconds, 10_000);
  assert.equal(hostedDeepSeekLogoutBudgetMilliseconds, 10_000);
  assert.equal(hostedDeepSeekOperationLeaseMaximumAfterArmMilliseconds, 120_000);
});

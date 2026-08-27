import assert from "node:assert/strict";
import test from "node:test";

import { hostedDeepSeekAnalysisRequestBody } from "./acceptance-hosted-deepseek-one-shot-analysis-request.mjs";
import {
  createHostedDeepSeekOneShotExecutor,
  hostedDeepSeekAnalysisStreamPath,
  hostedDeepSeekWebOrigin,
} from "./acceptance-hosted-deepseek-one-shot.mjs";
import {
  approval,
  deployments,
  identity,
  ledgerEntry,
  nowMilliseconds,
  ownerUsage,
  postSnapshot,
  preSnapshot,
  requestHandle,
  settlement,
  unsafePreflightCases,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";
import {
  adapter,
  operationLifecycle,
} from "./acceptance-hosted-deepseek-one-shot-fake-adapters.mjs";

const failurePattern = /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;

function orchestrate(options = {}) {
  const { approval: executionApproval, ...dependencies } = {
    lifecycle: operationLifecycle(),
    readNowMilliseconds: () => nowMilliseconds,
    ...options,
  };
  return createHostedDeepSeekOneShotExecutor(dependencies).execute(executionApproval);
}

test("orchestrator claims once, binds the request, and closes cleanup after restoration", async () => {
  const calls = [];
  const externalSignal = new AbortController().signal;
  let invokedRequest;
  let invokeControl;
  let settlementControl;
  const applicationAdapter = adapter({
    calls,
    invoke: async (request, control) => {
      invokedRequest = request;
      invokeControl = control;
      return requestHandle();
    },
    reconcile: async (_handle, control) => {
      settlementControl = control;
      return settlement();
    },
  });
  applicationAdapter.analysisRequestBody = Object.freeze({
    selectionKind: "passage",
    source: Object.freeze({
      title: "override",
      type: "study-capture",
      userContext: "override",
    }),
    sourceText: "override",
  });
  const result = await orchestrate({
    adapter: applicationAdapter,
    approval: approval(),
    lifecycle: operationLifecycle({ calls }),
    signal: externalSignal,
  });

  assert.deepEqual(calls, [
    "pre-snapshot",
    "claim-operation",
    "login-password",
    "reauthenticate-password",
    "operator-readback",
    "arm-cleanup",
    "kill-switch:false",
    "mark-dispatch-attempted",
    `request:${hostedDeepSeekWebOrigin}${hostedDeepSeekAnalysisStreamPath}`,
    "bind-request",
    "server-settlement",
    "record-settlement",
    "kill-switch:true",
    "post-snapshot",
    "logout",
    "complete-cleanup",
    "complete-operation:accepted",
  ]);
  assert.deepEqual(invokedRequest, {
    body: hostedDeepSeekAnalysisRequestBody,
    deployments: deployments(),
    idempotencyKey: identity().idempotencyKey,
    operationId: identity().operationId,
    origin: hostedDeepSeekWebOrigin,
    ownerId: identity().ownerId,
    path: hostedDeepSeekAnalysisStreamPath,
  });
  assert.equal(invokedRequest.body, hostedDeepSeekAnalysisRequestBody);
  assert.deepEqual(Object.keys(invokeControl).sort(), [
    "applicationBudgetMilliseconds",
    "deadlineAt",
    "signal",
  ]);
  assert.equal(invokeControl.applicationBudgetMilliseconds, 90_000);
  assert.equal(invokeControl.deadlineAt, nowMilliseconds + 90_000);
  assert.notEqual(invokeControl.signal, externalSignal);
  assert.equal(invokeControl.signal.aborted, false);
  assert.equal(settlementControl, invokeControl);
  assert.deepEqual(result, {
    killSwitchRestored: true,
    outcome: "accepted",
  });
});

test("approval and deployed-candidate preflight gates reject before Hosted mutation", async () => {
  for (const testCase of unsafePreflightCases()) {
    const adapterCalls = [];
    const lifecycleCalls = [];
    await assert.rejects(
      orchestrate({
        adapter: adapter({ calls: adapterCalls, pre: testCase.pre }),
        approval: testCase.approval,
        lifecycle: operationLifecycle({ calls: lifecycleCalls }),
        readNowMilliseconds: testCase.readNowMilliseconds ?? (() => nowMilliseconds),
      }),
      failurePattern,
    );
    assert.deepEqual(adapterCalls, testCase.preRead ? ["pre-snapshot"] : []);
    assert.deepEqual(
      lifecycleCalls,
      testCase.claimRead ? ["claim-operation", "complete-operation:failed"] : [],
    );
    assert.equal(
      adapterCalls.some((call) => call.startsWith("kill-switch:")),
      false,
    );
  }
});

test("freshness clock is sampled immediately after pre-snapshot capture", async () => {
  const calls = [];
  let actionNowMilliseconds = nowMilliseconds;
  let readNowCalls = 0;
  await assert.rejects(
    orchestrate({
      adapter: adapter({
        calls,
        pre: async () => {
          actionNowMilliseconds += 30_001;
          return preSnapshot();
        },
      }),
      approval: approval(),
      readNowMilliseconds: () => {
        readNowCalls += 1;
        return actionNowMilliseconds;
      },
    }),
    failurePattern,
  );
  assert.equal(readNowCalls, 1);
  assert.deepEqual(calls, ["pre-snapshot"]);
});

test("server evidence must bind deployments, request identity, price UUID, and ledger usage", async () => {
  const wrongOwner = "70000000-0000-4000-8000-000000000007";
  const wrongPrice = "80000000-0000-4000-8000-000000000008";
  const unsafeSettlements = [
    settlement({ applicationRequestCount: 2 }),
    settlement({ billedCallCount: 2 }),
    settlement({ request: identity({ ownerId: wrongOwner }) }),
    settlement({
      deployments: deployments({ api: { ...deployments().api, deploymentId: "dpl_other_api" } }),
    }),
    settlement({ priceVersionId: wrongPrice }),
    settlement({ ledgerEntries: [ledgerEntry({ ownerId: wrongOwner })] }),
    settlement({ ledgerEntries: [ledgerEntry({ priceVersionId: wrongPrice })] }),
    settlement({ ledgerEntries: [ledgerEntry({ inputTokens: -1 })] }),
    settlement({ observedAt: "not-a-timestamp" }),
    settlement({ reservationMicroUsd: 501 }),
    settlement({ settlementSource: "client" }),
    settlement({ terminalState: "failed" }),
  ];

  for (const reconcile of unsafeSettlements) {
    const calls = [];
    await assert.rejects(
      orchestrate({
        adapter: adapter({ calls, reconcile }),
        approval: approval(),
        lifecycle: operationLifecycle({ calls }),
      }),
      failurePattern,
    );
    assert.equal(calls.filter((call) => call.startsWith("request:")).length, 1);
    assert.deepEqual(calls.slice(-5), [
      "kill-switch:true",
      "post-snapshot",
      "logout",
      "complete-cleanup",
      "complete-operation:failed",
    ]);
    assert.match(calls.join(","), /kill-switch:true,post-snapshot,logout,complete-cleanup/u);
  }
});

test("one structure repair is accepted only as two bound ledger calls with exact totals", async () => {
  const secondEntry = ledgerEntry({
    cachedInputTokens: 5,
    callOrdinal: 1,
    costMicroUsd: 9,
    id: "a0000000-0000-4000-8000-00000000000a",
    inputTokens: 80,
    outputTokens: 40,
  });
  const result = await orchestrate({
    adapter: adapter({
      post: postSnapshot({
        ownerUsage: ownerUsage({
          cachedInputTokens: 1_025,
          costMicroUsd: 1_026,
          inputTokens: 10_200,
          ledgerEntryCount: 12,
          outputTokens: 2_100,
        }),
      }),
      reconcile: settlement({
        billedCallCount: 2,
        ledgerEntries: [ledgerEntry(), secondEntry],
      }),
    }),
    approval: approval(),
  });
  assert.deepEqual(result, { killSwitchRestored: true, outcome: "accepted" });
});

test("every application, interruption, restoration, and post failure remains fail-closed", async () => {
  const privateDetail = "sk-private-provider-detail";
  const requestInterruption = new AbortController();
  const scenarios = [
    {
      expectedRequests: 1,
      invoke: async () => {
        throw new Error(privateDetail);
      },
      reconcileDispatch: { complete: true, matches: [] },
    },
    {
      expectedRequests: 1,
      invoke: async () => {
        requestInterruption.abort(privateDetail);
        return requestHandle();
      },
      signal: requestInterruption.signal,
    },
    {
      expectedRequests: 0,
      setKillSwitch: async (enabled) => {
        if (!enabled) throw new Error(privateDetail);
      },
    },
    {
      expectedRequests: 1,
      reconcile: async () => {
        throw new Error(privateDetail);
      },
    },
    {
      expectedRequests: 1,
      setKillSwitch: async (enabled) => {
        if (enabled) throw new Error(privateDetail);
      },
    },
    {
      expectedRequests: 1,
      post: async () => {
        throw new Error(privateDetail);
      },
    },
  ];

  for (const scenario of scenarios) {
    const calls = [];
    let message = "";
    try {
      await orchestrate({
        adapter: adapter({ calls, ...scenario }),
        approval: approval(),
        lifecycle: operationLifecycle({ calls }),
        signal: scenario.signal,
      });
      assert.fail("Expected one-shot failure.");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.equal(message, "Hosted Cloud Web DeepSeek one-shot failed closed.");
    assert.doesNotMatch(message, new RegExp(privateDetail, "u"));
    assert.equal(
      calls.filter((call) => call.startsWith("request:")).length,
      scenario.expectedRequests,
    );
    assert.match(calls.join(","), /kill-switch:true,post-snapshot/u);
    assert.match(calls.at(-1), /^complete-operation:failed(?:-cleanup-pending)?$/u);
  }
});

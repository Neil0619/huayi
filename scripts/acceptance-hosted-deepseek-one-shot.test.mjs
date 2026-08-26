import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedDeepSeekApplicationBudgetMilliseconds,
  hostedDeepSeekOneShotConfirmation,
  hostedDeepSeekWebOrigin,
  hostedDeepSeekWebPath,
  orchestrateHostedDeepSeekOneShot,
  renderHostedDeepSeekOneShotPlan,
  runHostedDeepSeekOneShotCli,
} from "./acceptance-hosted-deepseek-one-shot.mjs";
import {
  adapter,
  approval,
  deployments,
  identity,
  ledgerEntry,
  nowMilliseconds,
  operationLifecycle,
  ownerUsage,
  postSnapshot,
  preSnapshot,
  priceVersionId,
  requestHandle,
  requestId,
  settlement,
  unsafePreflightCases,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";

const failurePattern = /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;

function orchestrate(options = {}) {
  return orchestrateHostedDeepSeekOneShot({
    lifecycle: operationLifecycle(),
    readNowMilliseconds: () => nowMilliseconds,
    ...options,
  });
}

test("DeepSeek plan is fixed, zero-I/O, Cloud-Web-only, and exposes no real executor", async () => {
  let stdout = "";
  let stderr = "";
  const privateValue = "sk-private-must-not-appear";
  const code = await runHostedDeepSeekOneShotCli({
    arguments_: ["plan"],
    environment: { DEEPSEEK_API_KEY: privateValue },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, renderHostedDeepSeekOneShotPlan());
  assert.match(stdout, /zero filesystem \/ zero Git \/ zero network \/ zero Hosted write/u);
  assert.match(stdout, new RegExp(`${hostedDeepSeekWebOrigin}${hostedDeepSeekWebPath}`, "u"));
  for (const expected of [
    "Classic `pnpm smoke:deepseek` is forbidden",
    "no default real executor",
    "hidden interactive channel",
    "atomically consume the operation",
    "same approval can never dispatch twice",
    "READY Hosted API and Web deployments on that exact SHA",
    "durably arm a reclaimable cleanup lease",
    "Both validated leases must outlive the complete 90-second mutation window",
    "absolute 90-second deadline",
    "actual price-version UUID",
    "exact owner-usage delta",
  ]) {
    assert.match(stdout, new RegExp(expected.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(stdout, /adapter control only; never Web request body or Provider parameters/u);
  assert.doesNotMatch(stdout, new RegExp(privateValue, "u"));
  assert.equal(hostedDeepSeekApplicationBudgetMilliseconds, 90_000);

  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:deepseek:plan"],
    "node scripts/acceptance-hosted-deepseek-one-shot.mjs plan",
  );
  assert.equal(packageDocument.scripts["acceptance:hosted:deepseek:run"], undefined);
});

test("default CLI fails closed on every non-plan argument without external work", async () => {
  for (const arguments_ of [
    [],
    ["run"],
    ["run", hostedDeepSeekOneShotConfirmation],
    ["plan", "extra"],
  ]) {
    let stdout = "";
    let stderr = "";
    const code = await runHostedDeepSeekOneShotCli({
      arguments_,
      environment: { TOKEN: "private-token" },
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: (value) => {
        stdout += value;
      },
    });
    assert.deepEqual(
      { code, stderr, stdout },
      {
        code: 1,
        stderr: "Hosted Cloud Web DeepSeek one-shot failed closed.\n",
        stdout: "",
      },
    );
  }
});

test("orchestrator claims once, binds the request, and closes cleanup after restoration", async () => {
  const calls = [];
  const externalSignal = new AbortController().signal;
  let invokedRequest;
  let invokeControl;
  let settlementControl;
  const result = await orchestrate({
    adapter: adapter({
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
    }),
    approval: approval(),
    lifecycle: operationLifecycle({ calls }),
    signal: externalSignal,
  });

  assert.deepEqual(calls, [
    "claim-operation",
    "pre-snapshot",
    "arm-cleanup",
    "kill-switch:false",
    `request:${hostedDeepSeekWebOrigin}${hostedDeepSeekWebPath}`,
    "server-settlement",
    "kill-switch:true",
    "post-snapshot",
    "complete-cleanup",
    "complete-operation:accepted",
  ]);
  assert.deepEqual(invokedRequest, {
    deployments: deployments(),
    ...identity(),
    origin: hostedDeepSeekWebOrigin,
    path: hostedDeepSeekWebPath,
  });
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
    applicationPath: hostedDeepSeekWebPath,
    billedCallCount: 1,
    deadlineClassification: "completed-within-90-seconds",
    killSwitchRestored: true,
    outcome: "accepted",
    priceVersionId,
    priceVersionSlot: "off-peak",
    providerModel: "deepseek-v4-flash",
    requestCount: 1,
    requestId,
    usage: {
      cachedInputTokens: 20,
      costMicroUsd: 17,
      inputTokens: 120,
      outputTokens: 60,
    },
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
    assert.equal(lifecycleCalls.includes("arm-cleanup"), false);
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
  assert.equal(readNowCalls, 2);
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
    assert.deepEqual(calls.slice(-4), [
      "kill-switch:true",
      "post-snapshot",
      "complete-cleanup",
      "complete-operation:failed",
    ]);
    assert.match(calls.join(","), /kill-switch:true,post-snapshot,complete-cleanup/u);
  }
});

test("one structure repair is accepted only as two bound ledger calls with exact totals", async () => {
  const secondEntry = ledgerEntry({
    cachedInputTokens: 5,
    callOrdinal: 2,
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
  assert.equal(result.billedCallCount, 2);
  assert.deepEqual(result.usage, {
    cachedInputTokens: 25,
    costMicroUsd: 26,
    inputTokens: 200,
    outputTokens: 100,
  });
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

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
  nowMilliseconds,
  postSnapshot,
  preSnapshot,
  settlement,
  unsafePreflightCases,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";

function orchestrate(options) {
  return orchestrateHostedDeepSeekOneShot({
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
  assert.match(stdout, /one Cloud Web application request/u);
  assert.match(stdout, /Classic `pnpm smoke:deepseek` is forbidden/u);
  assert.match(stdout, /no default real executor/u);
  assert.match(
    stdout,
    /does not infer an admin endpoint, authentication flow, credential source, or remote response shape/u,
  );
  assert.match(stdout, /hidden interactive channel/u);
  assert.match(stdout, /adapter control only; never Web request body or Provider parameters/u);
  assert.match(stdout, /30-second pre-snapshot freshness/u);
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

test("orchestrator runs one Cloud Web request and restores the original kill switch", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  let invokeControl;
  let invokedRoute;
  let settlementControl;
  const result = await orchestrate({
    adapter: adapter({
      calls,
      invoke: async (route, control) => {
        invokedRoute = route;
        invokeControl = control;
        return { opaque: "request-handle" };
      },
      reconcile: async (_handle, control) => {
        settlementControl = control;
        return settlement();
      },
    }),
    approval: approval(),
    signal,
  });

  assert.deepEqual(calls, [
    "pre-snapshot",
    "kill-switch:false",
    `request:${hostedDeepSeekWebOrigin}${hostedDeepSeekWebPath}`,
    "server-settlement",
    "kill-switch:true",
    "post-snapshot",
  ]);
  assert.deepEqual(invokedRoute, {
    origin: hostedDeepSeekWebOrigin,
    path: hostedDeepSeekWebPath,
  });
  assert.deepEqual(Object.keys(invokedRoute).sort(), ["origin", "path"]);
  assert.deepEqual(Object.keys(invokeControl).sort(), ["applicationBudgetMilliseconds", "signal"]);
  assert.equal(
    invokeControl.applicationBudgetMilliseconds,
    hostedDeepSeekApplicationBudgetMilliseconds,
  );
  assert.equal(invokeControl.signal, signal);
  assert.equal(settlementControl, invokeControl);
  assert.deepEqual(result, {
    applicationPath: hostedDeepSeekWebPath,
    billedCallCount: 1,
    deadlineClassification: "completed-within-90-seconds",
    killSwitchRestored: true,
    outcome: "accepted",
    priceVersionSlot: "off-peak",
    providerModel: "deepseek-v4-flash",
    requestCount: 1,
  });
  assert.equal(JSON.stringify(result).includes("request-handle"), false);
});

test("approval and preflight gates reject before any Hosted mutation", async () => {
  for (const testCase of unsafePreflightCases()) {
    const calls = [];
    await assert.rejects(
      orchestrate({
        adapter: adapter({ calls, pre: testCase.pre }),
        approval: testCase.approval,
        readNowMilliseconds: testCase.readNowMilliseconds,
      }),
      /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u,
    );
    assert.deepEqual(calls, testCase.preRead ? ["pre-snapshot"] : []);
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
    /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u,
  );
  assert.equal(readNowCalls, 1);
  assert.deepEqual(calls, ["pre-snapshot"]);
});

test("invalid server authority evidence fails after restoration and post-snapshot", async () => {
  const unsafeSettlements = [
    settlement({ applicationRequestCount: 2 }),
    settlement({ billedCallCount: 3, ledgerEntryCount: 3 }),
    settlement({ deadlineClassification: "indeterminate" }),
    settlement({ priceVersionReconciled: false }),
    settlement({ reservationMicroUsd: 401 }),
    settlement({ reservationMicroUsd: 501 }),
    settlement({ reservationSettled: false }),
    settlement({ settlementSource: "client" }),
  ];

  for (const reconcile of unsafeSettlements) {
    const calls = [];
    await assert.rejects(
      orchestrate({
        adapter: adapter({ calls, reconcile }),
        approval: approval(),
      }),
      /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u,
    );
    assert.equal(calls.filter((call) => call.startsWith("request:")).length, 1);
    assert.deepEqual(calls.slice(-2), ["kill-switch:true", "post-snapshot"]);
  }
});

test("every mutation, settlement, interruption, and post failure attempts restoration", async () => {
  const privateDetail = "sk-private-provider-detail";
  const emptyPost = postSnapshot({
    applicationRequestCountDelta: 0,
    ledgerEntryCountDelta: 0,
    reservationStatus: "none",
    terminalRequestCountDelta: 0,
  });
  const requestInterruption = new AbortController();
  const settlementInterruption = new AbortController();
  for (const scenario of [
    {
      expectedRequests: 1,
      expectedSettlements: 0,
      invoke: async () => {
        throw new Error(privateDetail);
      },
      post: emptyPost,
    },
    {
      expectedRequests: 1,
      expectedSettlements: 0,
      invoke: async () => {
        requestInterruption.abort(privateDetail);
        return { opaque: "request-handle" };
      },
      post: emptyPost,
      signal: requestInterruption.signal,
    },
    {
      expectedRequests: 0,
      expectedSettlements: 0,
      post: emptyPost,
      setKillSwitch: async (enabled) => {
        if (!enabled) throw new Error(privateDetail);
      },
    },
    {
      expectedRequests: 1,
      expectedSettlements: 1,
      post: emptyPost,
      reconcile: async () => {
        throw new Error(privateDetail);
      },
    },
    {
      expectedRequests: 1,
      expectedSettlements: 1,
      reconcile: async () => {
        settlementInterruption.abort(privateDetail);
        return settlement();
      },
      signal: settlementInterruption.signal,
    },
    {
      expectedRequests: 1,
      expectedSettlements: 1,
      post: postSnapshot({ killSwitchEnabled: false }),
      setKillSwitch: async (enabled) => {
        if (enabled) throw new Error(privateDetail);
      },
    },
    {
      expectedRequests: 1,
      expectedSettlements: 1,
      post: async () => {
        throw new Error(privateDetail);
      },
    },
  ]) {
    const calls = [];
    let message = "";
    try {
      await orchestrate({
        adapter: adapter({ calls, ...scenario }),
        approval: approval(),
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
    assert.equal(
      calls.filter((call) => call === "server-settlement").length,
      scenario.expectedSettlements,
    );
    assert.match(calls.join(","), /kill-switch:true,post-snapshot$/u);
  }
});

test("post-snapshot must prove restoration and exactly one terminal request", async () => {
  for (const post of [
    postSnapshot({ applicationRequestCountDelta: 2 }),
    postSnapshot({ killSwitchEnabled: false }),
    postSnapshot({ ledgerEntryCountDelta: 2 }),
    postSnapshot({ reservationStatus: "active" }),
    postSnapshot({ terminalRequestCountDelta: 0 }),
  ]) {
    const calls = [];
    await assert.rejects(
      orchestrate({
        adapter: adapter({ calls, post }),
        approval: approval(),
      }),
      /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u,
    );
    assert.equal(calls.filter((call) => call.startsWith("request:")).length, 1);
    assert.deepEqual(calls.slice(-2), ["kill-switch:true", "post-snapshot"]);
  }
});

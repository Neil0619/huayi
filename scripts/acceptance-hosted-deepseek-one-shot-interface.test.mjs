import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { hostedDeepSeekAnalysisRequestBody as canonicalRequestBody } from "./acceptance-hosted-deepseek-one-shot-analysis-request.mjs";
import * as oneShotModule from "./acceptance-hosted-deepseek-one-shot.mjs";
import {
  adapter,
  operationLifecycle,
} from "./acceptance-hosted-deepseek-one-shot-fake-adapters.mjs";
import {
  approval,
  identity,
  nowMilliseconds,
  requestId,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";

const failurePattern = /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;
const payloadDigest = oneShotModule.hostedDeepSeekPayloadDigest;

function createFactoryDependencies({
  calls = [],
  invoke,
  pendingCleanup,
  readStatus = async () => ({
    authority: "hosted-deepseek-one-shot",
    records: [],
  }),
  reconcileDispatchedRequest = async () => ({
    complete: true,
    matches: [
      {
        idempotencyKey: identity().idempotencyKey,
        ownerId: identity().ownerId,
        payloadDigest,
        requestId,
      },
    ],
  }),
  setKillSwitch,
} = {}) {
  const lifecycle = operationLifecycle({ calls, pendingCleanup });
  lifecycle.readStatus = async (control) => {
    calls.push("read-status");
    return readStatus(control);
  };
  const baseMarkDispatchAttempted = lifecycle.markDispatchAttempted;
  lifecycle.markDispatchAttempted = async (command) => {
    assert.equal(command.payloadDigest, payloadDigest);
    return baseMarkDispatchAttempted(command);
  };

  const applicationAdapter = adapter({ calls, invoke, setKillSwitch });
  applicationAdapter.reconcileDispatchedRequest = async (command, control) => {
    calls.push("reconcile-request");
    assert.deepEqual(command, {
      idempotencyKey: identity().idempotencyKey,
      ownerId: identity().ownerId,
      payloadDigest,
    });
    return reconcileDispatchedRequest(command, control);
  };
  return {
    adapter: applicationAdapter,
    lifecycle,
    readNowMilliseconds: () => nowMilliseconds,
  };
}

function createExecutor(dependencies = createFactoryDependencies()) {
  assert.equal(typeof oneShotModule.createHostedDeepSeekOneShotExecutor, "function");
  return oneShotModule.createHostedDeepSeekOneShotExecutor(dependencies);
}

test("the normal-Web request body is exact, deeply frozen, and digest-bound", () => {
  const canonicalPayload =
    '{"selectionKind":"sentence","source":{"type":"manual"},"sourceText":"The team checked every detail before it made one careful decision."}';
  assert.deepEqual(canonicalRequestBody, {
    selectionKind: "sentence",
    source: { type: "manual" },
    sourceText: "The team checked every detail before it made one careful decision.",
  });
  assert.deepEqual(Object.keys(canonicalRequestBody), ["selectionKind", "source", "sourceText"]);
  assert.deepEqual(Object.keys(canonicalRequestBody.source), ["type"]);
  assert.equal(Object.isFrozen(canonicalRequestBody), true);
  assert.equal(Object.isFrozen(canonicalRequestBody.source), true);
  assert.equal(JSON.stringify(canonicalRequestBody), canonicalPayload);
  assert.equal(
    payloadDigest,
    createHash("sha256").update(JSON.stringify(canonicalRequestBody)).digest("hex"),
  );
  assert.equal(payloadDigest, "7f260d4d76123414b9664dbd9851cba457fb38899ec4026fcc383c0792a07777");

  for (const mutation of [
    () => {
      canonicalRequestBody.selectionKind = "passage";
    },
    () => {
      canonicalRequestBody.source.type = "study-capture";
    },
    () => {
      canonicalRequestBody.source.title = "override";
    },
    () => {
      canonicalRequestBody.source.userContext = "override";
    },
    () => {
      canonicalRequestBody.sourceText = "override";
    },
  ]) {
    assert.throws(mutation, TypeError);
  }
});

test("Phase A exposes only status, execute, and recover on the deep executor seam", async () => {
  const executor = createExecutor();
  assert.deepEqual(Object.keys(executor).sort(), ["execute", "recover", "status"]);
  assert.equal(Object.isFrozen(executor), true);
  assert.equal("hostedDeepSeekAnalysisRequestBody" in oneShotModule, false);
  assert.equal("orchestrateHostedDeepSeekOneShot" in oneShotModule, false);
  assert.equal("recoverHostedDeepSeekOneShotCleanup" in oneShotModule, false);

  await assert.rejects(executor.status(identity()), failurePattern);
  await assert.rejects(executor.recover(identity()), failurePattern);
});

test("caller fields cannot override the fixed normal-Web analysis body", async () => {
  for (const override of [
    { selectionKind: "passage" },
    { source: { type: "study-capture" } },
    { source: { title: "override", type: "manual" } },
    { source: { type: "manual", userContext: "override" } },
    { sourceText: "override" },
  ]) {
    const calls = [];
    const executor = createExecutor(createFactoryDependencies({ calls }));
    await assert.rejects(executor.execute({ ...approval(), ...override }), failurePattern);
    assert.deepEqual(calls, []);
  }

  const calls = [];
  const executor = createExecutor(createFactoryDependencies({ calls }));
  await assert.rejects(
    executor.execute(approval(), {
      sourceText: "override",
    }),
    failurePattern,
  );
  assert.deepEqual(calls, []);
});

test("Phase A status is bounded, read-only, and classifies only one known authority record", async () => {
  for (const state of ["ready", "running", "cleanup-pending", "terminal"]) {
    const calls = [];
    const executor = createExecutor(
      createFactoryDependencies({
        calls,
        readStatus: async (control) => {
          assert.equal(control.statusBudgetMilliseconds, 5_000);
          assert.equal(control.deadlineAt, nowMilliseconds + 5_000);
          return {
            authority: "hosted-deepseek-one-shot",
            records: [{ state }],
          };
        },
      }),
    );
    assert.deepEqual(await executor.status(), { state });
    assert.deepEqual(calls, ["read-status"]);
  }

  const absentCalls = [];
  const absentExecutor = createExecutor(createFactoryDependencies({ calls: absentCalls }));
  assert.deepEqual(await absentExecutor.status(), { state: "absent" });
  assert.deepEqual(absentCalls, ["read-status"]);

  for (const snapshot of [
    { authority: "hosted-deepseek-one-shot", records: [{ state: "unknown" }] },
    {
      authority: "hosted-deepseek-one-shot",
      records: [{ state: "running" }, { state: "cleanup-pending" }],
    },
    { authority: "unknown", records: [] },
  ]) {
    const calls = [];
    const executor = createExecutor(
      createFactoryDependencies({ calls, readStatus: async () => snapshot }),
    );
    await assert.rejects(executor.status(), failurePattern);
    assert.deepEqual(calls, ["read-status"]);
  }
});

test("Phase A status deadline wins over an authority that ignores abort", async () => {
  let fireDeadline;
  let statusControl;
  const dependencies = createFactoryDependencies({
    readStatus: async (control) => {
      statusControl = control;
      queueMicrotask(fireDeadline);
      return new Promise(() => undefined);
    },
  });
  const executor = createExecutor({
    ...dependencies,
    clearTimeout_: () => undefined,
    setTimeout_: (callback, milliseconds) => {
      assert.equal(milliseconds, 5_000);
      fireDeadline = callback;
      return 1;
    },
  });

  await assert.rejects(executor.status(), failurePattern);
  assert.equal(statusControl.statusBudgetMilliseconds, 5_000);
  assert.equal(statusControl.signal.aborted, true);
});

test("Phase A status hides timer cleanup failures", async () => {
  const privateDetail = "private timer cleanup failure";
  const executor = createExecutor({
    ...createFactoryDependencies(),
    clearTimeout_: () => {
      throw new Error(privateDetail);
    },
    setTimeout_: () => 1,
  });

  let message = "";
  try {
    await executor.status();
    assert.fail("Expected status failure.");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message, "Hosted Cloud Web DeepSeek one-shot failed closed.");
  assert.doesNotMatch(message, new RegExp(privateDetail, "u"));
});

test("Phase A reconciles one disconnected POST, binds it, settles it, and never posts again", async () => {
  const calls = [];
  let restoreAttempts = 0;
  const executor = createExecutor(
    createFactoryDependencies({
      calls,
      invoke: async () => {
        throw new Error("private disconnect before analysis.started");
      },
      setKillSwitch: async (enabled) => {
        if (enabled && restoreAttempts++ === 0) {
          throw new Error("private first cleanup interruption");
        }
      },
    }),
  );

  await assert.rejects(executor.execute(approval()), failurePattern);
  assert.deepEqual(await executor.recover(), {
    killSwitchRestored: true,
    outcome: "restored",
  });
  assert.equal(calls.filter((call) => call.startsWith("request:")).length, 1);
  assert.equal(calls.filter((call) => call === "reconcile-request").length, 1);
  assert.equal(calls.filter((call) => call === "bind-request").length, 1);
  assert.equal(calls.filter((call) => call === "server-settlement").length, 1);
  assert.ok(calls.indexOf("mark-dispatch-attempted") < calls.indexOf("reconcile-request"));
  assert.ok(calls.indexOf("reconcile-request") < calls.indexOf("bind-request"));
});

test("Phase A rejects zero, multiple, incomplete, or mismatched reconciliation without replay", async () => {
  const unsafeResults = [
    { complete: true, matches: [] },
    {
      complete: true,
      matches: [
        {
          idempotencyKey: identity().idempotencyKey,
          ownerId: identity().ownerId,
          payloadDigest,
          requestId,
        },
        {
          idempotencyKey: identity().idempotencyKey,
          ownerId: identity().ownerId,
          payloadDigest,
          requestId: "90000000-0000-4000-8000-000000000009",
        },
      ],
    },
    {
      complete: false,
      matches: [
        {
          idempotencyKey: identity().idempotencyKey,
          ownerId: identity().ownerId,
          payloadDigest,
          requestId,
        },
      ],
    },
    {
      complete: true,
      matches: [
        {
          idempotencyKey: identity().idempotencyKey,
          ownerId: identity().ownerId,
          payloadDigest: "0".repeat(64),
          requestId,
        },
      ],
    },
  ];

  for (const reconciliation of unsafeResults) {
    const calls = [];
    const executor = createExecutor(
      createFactoryDependencies({
        calls,
        invoke: async () => {
          throw new Error("private disconnect before analysis.started");
        },
        reconcileDispatchedRequest: async () => reconciliation,
      }),
    );
    await assert.rejects(executor.execute(approval()), failurePattern);
    assert.equal(calls.filter((call) => call.startsWith("request:")).length, 1);
    assert.equal(calls.filter((call) => call === "reconcile-request").length, 1);
    assert.equal(calls.includes("bind-request"), false);
    assert.equal(calls.includes("server-settlement"), false);
    assert.deepEqual(calls.slice(-5), [
      "kill-switch:true",
      "post-snapshot",
      "logout",
      "complete-cleanup",
      "complete-operation:failed",
    ]);
  }
});

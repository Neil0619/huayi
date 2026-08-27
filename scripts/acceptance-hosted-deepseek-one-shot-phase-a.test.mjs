import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalIsValid,
  deploymentsAreValid,
} from "./acceptance-hosted-deepseek-one-shot-contract.mjs";
import { settlementIsValid } from "./acceptance-hosted-deepseek-one-shot-evidence.mjs";
import {
  createHostedDeepSeekOneShotExecutor,
  hostedDeepSeekOneShotConfirmation,
  hostedDeepSeekPayloadDigest,
  hostedDeepSeekWebOrigin,
} from "./acceptance-hosted-deepseek-one-shot.mjs";
import { adapter } from "./acceptance-hosted-deepseek-one-shot-fake-adapters.mjs";
import {
  candidateCommit,
  deployments,
  identity,
  ledgerEntry,
  nowMilliseconds,
  operationId,
  ownerId,
  postSnapshot,
  preSnapshot,
  requestId,
  settlement,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";

const failurePattern = /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;
const idempotencyKey = "hosted-deepseek-one-shot-001";
const phaseAApproval = Object.freeze({
  candidateCommit,
  confirmation: hostedDeepSeekOneShotConfirmation,
  maximumReservationMicroUsd: 500,
});
const phaseADeployments = Object.freeze({
  ...deployments(),
  web: Object.freeze({
    ...deployments().web,
    commit: "2".repeat(40),
  }),
});
const phaseAIdentity = Object.freeze(identity());

function phaseAOperationLease() {
  return {
    candidateCommit,
    claimToken: "claim_token_001",
    idempotencyKey,
    leaseExpiresAt: "2026-08-26T02:12:03.000Z",
    leaseGeneration: 1,
    maximumReservationMicroUsd: 500,
    operationId,
    ownerId,
  };
}

function phaseACleanupLease() {
  return {
    armedAt: "2026-08-26T02:10:03.000Z",
    claimGeneration: 1,
    cleanupToken: "cleanup_token_001",
    deployments: phaseADeployments,
    desiredKillSwitchEnabled: true,
    leaseExpiresAt: "2026-08-26T02:12:03.000Z",
    operationId,
  };
}

function phaseALifecycle({ calls = [], pendingCleanup = phaseACleanupLease() } = {}) {
  let pending = pendingCleanup;
  let operationState = pending === undefined ? "absent" : "cleanup-pending";
  return {
    armCleanup: async (command) => {
      calls.push("arm-cleanup");
      assert.equal(command.requestId, undefined);
      pending = phaseACleanupLease();
      return pending;
    },
    bindRequest: async (command) => {
      calls.push("bind-request");
      assert.equal(command.requestId, requestId);
      return { ...phaseAIdentity, status: "bound" };
    },
    claimCleanup: async (...arguments_) => {
      calls.push("claim-cleanup");
      assert.equal(arguments_.length, 0);
      return pending;
    },
    claimOperation: async (command) => {
      calls.push("claim-operation");
      assert.deepEqual(command, {
        ...phaseAApproval,
        deployments: phaseADeployments,
        payloadDigest: hostedDeepSeekPayloadDigest,
      });
      operationState = "running";
      return phaseAOperationLease();
    },
    completeCleanup: async (command) => {
      calls.push("complete-cleanup");
      pending = undefined;
      if (operationState === "cleanup-pending") operationState = "terminal";
      return { operationId: command.operationId, operationState, status: "completed" };
    },
    completeOperation: async (command) => {
      calls.push(`complete-operation:${command.outcome}`);
      operationState =
        command.outcome === "failed-cleanup-pending" ? "cleanup-pending" : "terminal";
      return { operationId: command.operationId, outcome: command.outcome, status: "completed" };
    },
    markDispatchAttempted: async (command) => {
      calls.push("mark-dispatch-attempted");
      return { operationId: command.operationId, status: "dispatch-attempted" };
    },
    readStatus: async () => ({
      authority: "hosted-deepseek-one-shot",
      records: operationState === "absent" ? [] : [{ state: operationState }],
    }),
    recordSettlement: async (command) => {
      calls.push("record-settlement");
      return {
        operationId: command.operationId,
        requestId: command.requestId,
        status: "recorded",
      };
    },
  };
}

function phaseAAdapter(calls = [], overrides = {}) {
  return adapter({
    calls,
    invoke: async (request) => {
      assert.equal(request.requestId, undefined);
      assert.equal(request.path, "/v1/analyses:stream");
      return { requestId, type: "analysis.started" };
    },
    post: postSnapshot({ deployments: phaseADeployments }),
    pre: preSnapshot({ deployments: phaseADeployments }),
    reconcile: settlement({
      deployments: phaseADeployments,
      ledgerEntries: [ledgerEntry({ callOrdinal: 0 })],
    }),
    ...overrides,
  });
}

test("Phase A approval owns no operation, request, owner, or idempotency identity", () => {
  assert.equal(approvalIsValid(phaseAApproval, hostedDeepSeekOneShotConfirmation), true);
  for (const [field, value] of Object.entries(phaseAIdentity)) {
    assert.equal(
      approvalIsValid({ ...phaseAApproval, [field]: value }, hostedDeepSeekOneShotConfirmation),
      false,
      field,
    );
  }
});

test("Phase A accepts an exact API/Web deployment pair with independent full SHAs", () => {
  assert.equal(deploymentsAreValid(phaseADeployments, candidateCommit), true);
  assert.equal(
    deploymentsAreValid({ ...phaseADeployments, extra: phaseADeployments.api }, candidateCommit),
    false,
  );
});

test("Phase A settlement accepts only continuous zero-based ledger ordinals", () => {
  const pre = preSnapshot({ deployments: phaseADeployments });
  const current = settlement({
    deployments: phaseADeployments,
    ledgerEntries: [ledgerEntry({ callOrdinal: 0 })],
  });
  assert.equal(settlementIsValid(current, phaseAApproval, pre, phaseAIdentity), true);
  assert.equal(
    settlementIsValid(
      { ...current, ledgerEntries: [ledgerEntry({ callOrdinal: 1 })] },
      phaseAApproval,
      pre,
      phaseAIdentity,
    ),
    false,
  );
});

test("Phase A persists dispatch before HTTP, then binds analysis.started and returns no opaque data", async () => {
  const calls = [];
  const executor = createHostedDeepSeekOneShotExecutor({
    adapter: phaseAAdapter(calls),
    lifecycle: phaseALifecycle({ calls }),
    readNowMilliseconds: () => nowMilliseconds,
  });
  const result = await executor.execute(phaseAApproval);

  assert.deepEqual(result, { killSwitchRestored: true, outcome: "accepted" });
  assert.ok(
    calls.indexOf("mark-dispatch-attempted") <
      calls.indexOf("request:https://app.acceptance.seen-said.cn/v1/analyses:stream"),
  );
  assert.ok(
    calls.indexOf("request:https://app.acceptance.seen-said.cn/v1/analyses:stream") <
      calls.indexOf("bind-request"),
  );
  assert.deepEqual(calls, [
    "pre-snapshot",
    "claim-operation",
    "login-password",
    "reauthenticate-password",
    "operator-readback",
    "arm-cleanup",
    "kill-switch:false",
    "mark-dispatch-attempted",
    `request:${hostedDeepSeekWebOrigin}/v1/analyses:stream`,
    "bind-request",
    "server-settlement",
    "record-settlement",
    "kill-switch:true",
    "post-snapshot",
    "logout",
    "complete-cleanup",
    "complete-operation:accepted",
  ]);
});

test("Phase A recovery takes no operation id and fails closed unless one cleanup is claimable", async () => {
  const calls = [];
  const executor = createHostedDeepSeekOneShotExecutor({
    adapter: phaseAAdapter(calls),
    lifecycle: phaseALifecycle({ calls }),
    readNowMilliseconds: () => nowMilliseconds,
  });
  const result = await executor.recover();
  assert.deepEqual(result, { killSwitchRestored: true, outcome: "restored" });
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

  for (const pendingCleanup of [null, [], [phaseACleanupLease(), phaseACleanupLease()]]) {
    const unsafeCalls = [];
    const unsafeExecutor = createHostedDeepSeekOneShotExecutor({
      adapter: phaseAAdapter(unsafeCalls),
      lifecycle: phaseALifecycle({ calls: unsafeCalls, pendingCleanup }),
      readNowMilliseconds: () => nowMilliseconds,
    });
    await assert.rejects(unsafeExecutor.recover(), failurePattern);
    assert.deepEqual(unsafeCalls, ["claim-cleanup"]);
  }

  for (const [field, value] of Object.entries(phaseAIdentity)) {
    const opaqueCalls = [];
    const opaqueExecutor = createHostedDeepSeekOneShotExecutor({
      adapter: phaseAAdapter(opaqueCalls),
      lifecycle: phaseALifecycle({ calls: opaqueCalls }),
      readNowMilliseconds: () => nowMilliseconds,
    });
    await assert.rejects(opaqueExecutor.recover({ [field]: value }), failurePattern);
    assert.deepEqual(opaqueCalls, [], field);
  }
});

test("Phase A restores the fuse without fabricated request evidence when dispatch marking fails", async () => {
  const calls = [];
  const lifecycle = phaseALifecycle({ calls });
  lifecycle.markDispatchAttempted = async (command) => {
    calls.push("mark-dispatch-attempted");
    return { operationId: command.operationId, status: "rejected" };
  };
  const pre = preSnapshot({ deployments: phaseADeployments });
  const executor = createHostedDeepSeekOneShotExecutor({
    adapter: phaseAAdapter(calls, {
      invoke: async () => assert.fail("HTTP must not run after an invalid dispatch receipt."),
      post: postSnapshot({
        applicationRequestCountDelta: 0,
        deployments: phaseADeployments,
        ownerUsage: pre.ownerUsage,
        request: null,
        reservationStatus: "none",
        terminalRequestCountDelta: 0,
      }),
    }),
    lifecycle,
    readNowMilliseconds: () => nowMilliseconds,
  });

  await assert.rejects(executor.execute(phaseAApproval), failurePattern);

  assert.equal(
    calls.some((call) => call.startsWith("request:")),
    false,
  );
  assert.deepEqual(calls.slice(-5), [
    "kill-switch:true",
    "post-snapshot",
    "logout",
    "complete-cleanup",
    "complete-operation:failed",
  ]);
});

test("Phase A recovery after a bound-request settlement crash never dispatches again", async () => {
  const calls = [];
  const lifecycle = phaseALifecycle({ calls });
  let rejectFirstRestore = true;
  const executionExecutor = createHostedDeepSeekOneShotExecutor({
    adapter: phaseAAdapter(calls, {
      reconcile: async () => {
        throw new Error("private settlement interruption");
      },
      setKillSwitch: async (enabled) => {
        if (enabled && rejectFirstRestore) {
          rejectFirstRestore = false;
          throw new Error("private first restore interruption");
        }
      },
    }),
    lifecycle,
    readNowMilliseconds: () => nowMilliseconds,
  });

  await assert.rejects(executionExecutor.execute(phaseAApproval), failurePattern);

  const recoveryExecutor = createHostedDeepSeekOneShotExecutor({
    adapter: phaseAAdapter(calls),
    lifecycle,
    readNowMilliseconds: () => nowMilliseconds,
  });
  const result = await recoveryExecutor.recover();

  assert.deepEqual(result, { killSwitchRestored: true, outcome: "restored" });
  assert.equal(
    calls.filter((call) => call === `request:${hostedDeepSeekWebOrigin}/v1/analyses:stream`).length,
    1,
  );
  assert.equal(calls.filter((call) => call === "bind-request").length, 1);
});

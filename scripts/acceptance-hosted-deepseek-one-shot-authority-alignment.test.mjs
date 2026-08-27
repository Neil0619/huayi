import assert from "node:assert/strict";
import test from "node:test";

import {
  createHostedDeepSeekOneShotExecutor,
  hostedDeepSeekPayloadDigest,
  hostedDeepSeekPreSnapshotFreshnessMilliseconds,
} from "./acceptance-hosted-deepseek-one-shot.mjs";
import {
  approval,
  cleanupLease,
  deployments,
  identity,
  nowMilliseconds,
  postObservedAt,
  preSnapshot,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";
import {
  adapter,
  operationLifecycle,
} from "./acceptance-hosted-deepseek-one-shot-fake-adapters.mjs";

const failurePattern = /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;

function createExecutor({ applicationAdapter, lifecycle }) {
  return createHostedDeepSeekOneShotExecutor({
    adapter: applicationAdapter,
    lifecycle,
    readNowMilliseconds: () => nowMilliseconds,
  });
}

test("Phase A validates the fresh snapshot before the first lifecycle mutation", async () => {
  const unsafeSnapshots = [
    preSnapshot({ killSwitchEnabled: false }),
    preSnapshot({
      deployments: deployments({
        api: { ...deployments().api, deploymentId: "dpl_api_candidate_001" },
      }),
    }),
  ];

  for (const pre of unsafeSnapshots) {
    const calls = [];
    const executor = createExecutor({
      applicationAdapter: adapter({ calls, pre }),
      lifecycle: operationLifecycle({ calls }),
    });

    await assert.rejects(executor.execute(approval()), failurePattern);
    assert.deepEqual(calls, ["pre-snapshot"]);
  }
});

test("Phase A private lifecycle commands carry the 0016 identity and fence material", async () => {
  const baseLifecycle = operationLifecycle();
  const commands = {};
  const lifecycle = {
    ...baseLifecycle,
    armCleanup: async (command) => {
      commands.armCleanup = command;
      return baseLifecycle.armCleanup(command);
    },
    bindRequest: async (command) => {
      commands.bindRequest = command;
      return baseLifecycle.bindRequest(command);
    },
    claimOperation: async (command) => {
      commands.claimOperation = command;
      return baseLifecycle.claimOperation(command);
    },
    completeCleanup: async (command) => {
      commands.completeCleanup = command;
      return baseLifecycle.completeCleanup(command);
    },
    completeOperation: async (command) => {
      commands.completeOperation = command;
      return baseLifecycle.completeOperation(command);
    },
    markDispatchAttempted: async (command) => {
      commands.markDispatchAttempted = command;
      return baseLifecycle.markDispatchAttempted(command);
    },
  };
  const executor = createExecutor({ applicationAdapter: adapter(), lifecycle });

  await executor.execute(approval());

  assert.deepEqual(commands.claimOperation, {
    ...approval(),
    deployments: deployments(),
    payloadDigest: hostedDeepSeekPayloadDigest,
  });
  assert.deepEqual(commands.armCleanup, {
    claimToken: "claim_token_001",
    deployments: deployments(),
    desiredKillSwitchEnabled: true,
    leaseGeneration: 1,
    observedAt: preSnapshot().observedAt,
    operationId: identity().operationId,
  });
  assert.deepEqual(commands.markDispatchAttempted, {
    claimToken: "claim_token_001",
    leaseGeneration: 1,
    operationId: identity().operationId,
    payloadDigest: hostedDeepSeekPayloadDigest,
  });
  assert.deepEqual(commands.bindRequest, {
    claimToken: "claim_token_001",
    idempotencyKey: identity().idempotencyKey,
    leaseGeneration: 1,
    operationId: identity().operationId,
    ownerId: identity().ownerId,
    requestId: identity().requestId,
  });
  assert.deepEqual(commands.completeCleanup, {
    claimGeneration: 1,
    cleanupToken: "cleanup_token_001",
    observedAt: postObservedAt,
    operationId: identity().operationId,
  });
  assert.deepEqual(commands.completeOperation, {
    claimToken: "claim_token_001",
    leaseGeneration: 1,
    operationId: identity().operationId,
    outcome: "accepted",
  });
});

test("Phase A recovery terminalizes the operation and releases the non-terminal status", async () => {
  const calls = [];
  const lifecycle = operationLifecycle({ calls, pendingCleanup: cleanupLease() });
  const executor = createExecutor({ applicationAdapter: adapter({ calls }), lifecycle });

  assert.deepEqual(await executor.recover(), {
    killSwitchRestored: true,
    outcome: "restored",
  });
  assert.deepEqual(await executor.status(), { state: "terminal" });
  assert.equal(lifecycle.pendingCleanup(), undefined);
  assert.deepEqual(Object.keys(executor).sort(), ["execute", "recover", "status"]);
});

test("Phase A cleanup recovery rejects identity material that must not be persisted", async () => {
  const calls = [];
  const legacyCleanup = {
    ...cleanupLease(),
    idempotencyKey: identity().idempotencyKey,
    ownerId: identity().ownerId,
  };
  const executor = createExecutor({
    applicationAdapter: adapter({ calls }),
    lifecycle: operationLifecycle({ calls, pendingCleanup: legacyCleanup }),
  });

  await assert.rejects(executor.recover(), failurePattern);
  assert.deepEqual(calls, ["claim-cleanup"]);
});

test("Phase A terminalizes a claimed operation when the snapshot expires during claim", async () => {
  const calls = [];
  const times = [
    nowMilliseconds,
    nowMilliseconds + hostedDeepSeekPreSnapshotFreshnessMilliseconds + 1,
  ];
  const executor = createHostedDeepSeekOneShotExecutor({
    adapter: adapter({ calls }),
    lifecycle: operationLifecycle({ calls }),
    readNowMilliseconds: () => times.shift(),
  });

  await assert.rejects(executor.execute(approval()), failurePattern);
  assert.deepEqual(calls, ["pre-snapshot", "claim-operation", "complete-operation:failed"]);
});

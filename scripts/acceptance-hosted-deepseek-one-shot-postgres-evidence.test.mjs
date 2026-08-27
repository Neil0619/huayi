import assert from "node:assert/strict";
import { test } from "node:test";

import { hostedDeepSeekPayloadDigest } from "./acceptance-hosted-deepseek-one-shot.mjs";
import {
  createHostedAcceptanceHmacKeyring,
  createHostedDeepSeekPostgresAuthority,
} from "./acceptance-hosted-deepseek-one-shot-postgres-authority.mjs";
import { createHostedDeepSeekPostgresEvidence } from "./acceptance-hosted-deepseek-one-shot-postgres-evidence.mjs";
import {
  deployments,
  identity,
  ledgerEntry,
  operationLease,
  priceVersionId,
  settlementObservedAt,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";

function frozenReceipt(overrides = {}) {
  const currentIdentity = identity();
  return {
    applicationRequestCount: 1,
    billedCallCount: 1,
    deadlineClassification: "completed-within-90-seconds",
    deployments: deployments(),
    ledgerEntries: [ledgerEntry()],
    model: "deepseek-v4-flash",
    observedAt: settlementObservedAt,
    payloadDigest: hostedDeepSeekPayloadDigest,
    priceVersionId,
    priceVersionSlot: "off-peak",
    request: {
      operationId: currentIdentity.operationId,
      ownerId: currentIdentity.ownerId,
      requestId: currentIdentity.requestId,
    },
    reservationMicroUsd: 400,
    reservationStatus: "settled",
    settlementSource: "server-authority",
    terminalState: "completed",
    ...overrides,
  };
}

test("uses fenced SQL reconciliation and never accepts a caller-selected request id", async () => {
  const calls = [];
  const evidence = createHostedDeepSeekPostgresEvidence({
    query: async (sql, parameters, control) => {
      calls.push({ control, parameters, sql });
      return { rows: [{ requestId: identity().requestId }] };
    },
  });
  const lease = operationLease();
  const control = Object.freeze({ deadlineAt: 123, signal: new AbortController().signal });
  const result = await evidence.reconcileDispatchedRequest(
    {
      claimToken: lease.claimToken,
      idempotencyKey: lease.idempotencyKey,
      leaseGeneration: lease.leaseGeneration,
      operationId: lease.operationId,
      ownerId: lease.ownerId,
      payloadDigest: hostedDeepSeekPayloadDigest,
    },
    control,
  );

  assert.deepEqual(result, {
    complete: true,
    matches: [
      {
        idempotencyKey: lease.idempotencyKey,
        ownerId: lease.ownerId,
        payloadDigest: hostedDeepSeekPayloadDigest,
        requestId: identity().requestId,
      },
    ],
  });
  assert.match(calls[0].sql, /reconcile_and_bind_hosted_acceptance_request/u);
  assert.deepEqual(calls[0].parameters, [
    lease.operationId,
    lease.leaseGeneration,
    lease.claimToken,
    lease.ownerId,
    lease.idempotencyKey,
    hostedDeepSeekPayloadDigest,
  ]);
  assert.equal(calls[0].control, control);
});

test("strictly parses a server-frozen receipt and restores only the in-memory idempotency key", async () => {
  const calls = [];
  const receiptDigest = "a".repeat(64);
  const evidence = createHostedDeepSeekPostgresEvidence({
    query: async (sql, parameters, control) => {
      calls.push({ control, parameters, sql });
      return { rows: [{ receipt: frozenReceipt(), receiptDigest }] };
    },
  });
  const lease = operationLease();
  const currentIdentity = identity();
  const control = Object.freeze({ deadlineAt: 123, signal: new AbortController().signal });
  const result = await evidence.readServerSettlement(currentIdentity, control, lease);
  const expectedSettlement = frozenReceipt();
  delete expectedSettlement.payloadDigest;

  assert.deepEqual(result, {
    ...expectedSettlement,
    request: currentIdentity,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.request), true);
  assert.equal(Object.prototype.propertyIsEnumerable.call(result, "receiptDigest"), false);
  assert.equal(result.receiptDigest, receiptDigest);
  assert.match(calls[0].sql, /read_and_freeze_hosted_acceptance_settlement/u);
  assert.deepEqual(calls[0].parameters, [
    lease.operationId,
    lease.leaseGeneration,
    lease.claimToken,
    currentIdentity.requestId,
  ]);
  assert.equal(calls[0].control, control);
});

test("fails closed on ambiguous rows, extra receipt fields, identity drift, or leaked content", async () => {
  const canary = "private-source-and-model-output-canary";
  for (const rows of [
    [],
    [
      { receipt: frozenReceipt(), receiptDigest: "a".repeat(64) },
      { receipt: frozenReceipt(), receiptDigest: "a".repeat(64) },
    ],
    [{ receipt: frozenReceipt({ extra: true }), receiptDigest: "a".repeat(64) }],
    [
      {
        receipt: frozenReceipt({
          request: {
            ...frozenReceipt().request,
            requestId: "90000000-0000-4000-8000-000000000009",
          },
        }),
        receiptDigest: "a".repeat(64),
      },
    ],
    [{ receipt: frozenReceipt({ sourceText: canary }), receiptDigest: "a".repeat(64) }],
  ]) {
    const evidence = createHostedDeepSeekPostgresEvidence({
      query: async () => ({ rows }),
    });
    let error;
    try {
      await evidence.readServerSettlement(identity(), {}, operationLease());
    } catch (caught) {
      error = caught;
    }
    assert.equal(error?.message, "Hosted settlement evidence failed closed.");
    assert.doesNotMatch(String(error), new RegExp(canary, "u"));
    assert.doesNotMatch(JSON.stringify(error), new RegExp(canary, "u"));
  }
});

test("never reflects query failures or private rows", async () => {
  const secret = "postgres-evidence-secret-canary";
  const evidence = createHostedDeepSeekPostgresEvidence({
    query: async () => {
      throw new Error(secret);
    },
  });
  let error;
  try {
    await evidence.reconcileDispatchedRequest(
      {
        ...identity(),
        claimToken: operationLease().claimToken,
        leaseGeneration: 1,
        payloadDigest: hostedDeepSeekPayloadDigest,
      },
      {},
    );
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.message, "Hosted settlement evidence failed closed.");
  assert.doesNotMatch(String(error), new RegExp(secret, "u"));
});

test("records only server-frozen settlement identity and carries the deadline to SQL", async () => {
  const calls = [];
  const authority = createHostedDeepSeekPostgresAuthority({
    keyring: createHostedAcceptanceHmacKeyring({
      activeVersion: 1,
      keys: new Map([[1, Buffer.alloc(32, 1)]]),
    }),
    query: async (sql, parameters, control) => {
      calls.push({ control, parameters, sql });
      return { rows: [{ requestId: identity().requestId }] };
    },
  });
  const lease = operationLease();
  const control = Object.freeze({ deadlineAt: 123, signal: new AbortController().signal });

  await assert.doesNotReject(
    authority.recordSettlement(
      {
        claimToken: lease.claimToken,
        leaseGeneration: lease.leaseGeneration,
        operationId: lease.operationId,
        requestId: identity().requestId,
      },
      control,
    ),
  );
  assert.match(calls[0].sql, /record_hosted_acceptance_settlement/u);
  assert.deepEqual(calls[0].parameters, [
    lease.operationId,
    lease.leaseGeneration,
    lease.claimToken,
    identity().requestId,
  ]);
  assert.equal(calls[0].control, control);
});

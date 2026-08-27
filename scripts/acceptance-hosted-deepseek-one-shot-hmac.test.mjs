import assert from "node:assert/strict";
import test from "node:test";

import {
  createHostedAcceptanceHmacKeyring,
  createHostedDeepSeekPostgresAuthority,
  hostedAcceptanceHmacContext,
} from "./acceptance-hosted-deepseek-one-shot-postgres-authority.mjs";

const operationId = "70000000-0000-4000-8000-000000000001";
const versionOneKey = Buffer.alloc(32, 1);
const versionTwoKey = Buffer.alloc(32, 2);

test("versioned HMAC rotates new operations while retaining old-operation recovery", () => {
  const oldProcess = createHostedAcceptanceHmacKeyring({
    activeVersion: 1,
    keys: new Map([[1, versionOneKey]]),
  });
  const original = oldProcess.create(operationId);

  const restartedProcess = createHostedAcceptanceHmacKeyring({
    activeVersion: 2,
    keys: new Map([
      [1, versionOneKey],
      [2, versionTwoKey],
    ]),
  });

  assert.equal(
    restartedProcess.recover({
      context: hostedAcceptanceHmacContext,
      operationId,
      verifier: original.verifier,
      version: original.version,
    }).idempotencyKey,
    original.idempotencyKey,
  );
  assert.equal(restartedProcess.create(operationId).version, 2);
  assert.notEqual(restartedProcess.create(operationId).idempotencyKey, original.idempotencyKey);
});

test("HMAC recovery fails closed for a wrong context, version, key, or verifier", () => {
  const original = createHostedAcceptanceHmacKeyring({
    activeVersion: 1,
    keys: new Map([[1, versionOneKey]]),
  }).create(operationId);
  const restartedProcess = createHostedAcceptanceHmacKeyring({
    activeVersion: 2,
    keys: new Map([
      [1, versionOneKey],
      [2, versionTwoKey],
    ]),
  });

  for (const recovery of [
    { ...original, context: `${hostedAcceptanceHmacContext}.wrong`, operationId },
    { ...original, context: hostedAcceptanceHmacContext, operationId, version: 99 },
    { ...original, context: hostedAcceptanceHmacContext, operationId, verifier: "0".repeat(64) },
  ]) {
    assert.throws(() => restartedProcess.recover(recovery), /failed closed/u);
  }

  const wrongKeyProcess = createHostedAcceptanceHmacKeyring({
    activeVersion: 1,
    keys: new Map([[1, versionTwoKey]]),
  });
  assert.throws(
    () =>
      wrongKeyProcess.recover({
        ...original,
        context: hostedAcceptanceHmacContext,
        operationId,
      }),
    /failed closed/u,
  );

  const reusedKeyAcrossVersions = createHostedAcceptanceHmacKeyring({
    activeVersion: 2,
    keys: new Map([
      [1, versionOneKey],
      [2, versionOneKey],
    ]),
  });
  assert.throws(
    () =>
      reusedKeyAcrossVersions.recover({
        ...original,
        context: hostedAcceptanceHmacContext,
        operationId,
        version: 2,
      }),
    /failed closed/u,
  );
  assert.notEqual(
    reusedKeyAcrossVersions.create(operationId).idempotencyKey,
    original.idempotencyKey,
  );
});

test("keyring public values and serialized material never contain raw key bytes", () => {
  const keyring = createHostedAcceptanceHmacKeyring({
    activeVersion: 1,
    keys: new Map([[1, versionOneKey]]),
  });
  const material = keyring.create(operationId);

  assert.deepEqual(Object.keys(material).sort(), [
    "context",
    "idempotencyKey",
    "verifier",
    "version",
  ]);
  assert.equal(JSON.stringify(keyring).includes(versionOneKey.toString("hex")), false);
  assert.equal(JSON.stringify(material).includes(versionOneKey.toString("hex")), false);
});

test("an explicitly supplied malformed recovery verifier fails before SQL binding", async () => {
  let queryCount = 0;
  const authority = createHostedDeepSeekPostgresAuthority({
    keyring: createHostedAcceptanceHmacKeyring({
      activeVersion: 1,
      keys: new Map([[1, versionOneKey]]),
    }),
    query: async () => {
      queryCount += 1;
      return { rows: [{ requestId: "72000000-0000-4000-8000-000000000001" }] };
    },
  });

  await assert.rejects(
    authority.bindRequest({
      claimToken: "claim-token",
      idempotencyKey: "hda_key",
      idempotencyVerifier: "malformed",
      leaseGeneration: 1,
      operationId,
      ownerId: "71000000-0000-4000-8000-000000000001",
      requestId: "72000000-0000-4000-8000-000000000001",
    }),
    /failed closed/u,
  );
  assert.equal(queryCount, 0);
});

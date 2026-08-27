import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyHostedAcceptanceMigrations,
  armCleanup,
  claimOperation,
  evidenceForwardUrl,
  hostedAcceptancePriceVersionId,
  insertAnalysisRequest,
  operationId,
  operationToken,
  ownerId,
  requestId,
  seedCompletedAnalysis,
  supabaseEvidenceForwardUrl,
  verifier,
} from "../test/hosted-deepseek-acceptance-authority-test-helpers.js";

async function markDispatch(database: PGlite): Promise<void> {
  await database.query(
    "SELECT huayi_private.mark_hosted_acceptance_dispatch($1,1,$2,repeat('c',64))",
    [operationId, operationToken],
  );
}

describe("Hosted DeepSeek acceptance evidence", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await applyHostedAcceptanceMigrations(database);
  });

  afterEach(async () => database.close());

  it("keeps the API and Supabase 0021 migration byte-identical", async () => {
    await expect(readFile(supabaseEvidenceForwardUrl, "utf8")).resolves.toBe(
      await readFile(evidenceForwardUrl, "utf8"),
    );
  });

  it("atomically reconciles and binds only the exact fenced product request", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await markDispatch(database);
    await insertAnalysisRequest(database);

    const result = await database.query<{ requestId: string }>(
      `SELECT request_id::text AS "requestId"
       FROM huayi_private.reconcile_and_bind_hosted_acceptance_request(
         $1,1,$2,$3,$4,repeat('c',64)
       )`,
      [operationId, operationToken, ownerId, "recovered-idempotency-key"],
    );
    expect(result.rows).toEqual([{ requestId }]);
    await expect(
      database.query(`SELECT huayi_private.bind_hosted_acceptance_request($1,1,$2,$3,$4,$5,$6)`, [
        operationId,
        operationToken,
        ownerId,
        requestId,
        "recovered-idempotency-key",
        verifier,
      ]),
    ).resolves.toBeDefined();

    const bound = await database.query<{ requestId: string }>(`
      SELECT server_request_id::text AS "requestId"
      FROM huayi_private.hosted_acceptance_operations
    `);
    expect(bound.rows).toEqual([{ requestId }]);
  });

  it("fails reconciliation closed for zero match, a stale fence, or a cross-tenant claim", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await markDispatch(database);

    for (const parameters of [
      [operationId, operationToken, ownerId, "recovered-idempotency-key"],
      [operationId, "stale-operation-token", ownerId, "recovered-idempotency-key"],
      [
        operationId,
        operationToken,
        "71000000-0000-4000-8000-000000000099",
        "recovered-idempotency-key",
      ],
    ]) {
      await expect(
        database.query(
          `SELECT * FROM huayi_private.reconcile_and_bind_hosted_acceptance_request(
            $1,1,$2,$3,$4,repeat('c',64)
          )`,
          parameters,
        ),
      ).rejects.toThrow();
    }
  });

  it("joins, validates, hashes, and freezes one canonical server receipt", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await markDispatch(database);
    await seedCompletedAnalysis(database);
    await database.query(
      `SELECT huayi_private.bind_hosted_acceptance_request($1,1,$2,$3,$4,$5,$6)`,
      [operationId, operationToken, ownerId, requestId, "recovered-idempotency-key", verifier],
    );

    const first = await database.query<{ receipt: Record<string, unknown>; receiptDigest: string }>(
      `SELECT receipt,receipt_digest AS "receiptDigest"
       FROM huayi_private.read_and_freeze_hosted_acceptance_settlement($1,1,$2,$3)`,
      [operationId, operationToken, requestId],
    );
    const replay = await database.query<{
      receipt: Record<string, unknown>;
      receiptDigest: string;
    }>(
      `SELECT receipt,receipt_digest AS "receiptDigest"
       FROM huayi_private.read_and_freeze_hosted_acceptance_settlement($1,1,$2,$3)`,
      [operationId, operationToken, requestId],
    );

    expect(replay.rows).toEqual(first.rows);
    expect(first.rows[0]?.receiptDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.rows[0]?.receipt).toMatchObject({
      applicationRequestCount: 1,
      billedCallCount: 1,
      deadlineClassification: "completed-within-90-seconds",
      model: "deepseek-v4-flash",
      payloadDigest: "c".repeat(64),
      priceVersionId: hostedAcceptancePriceVersionId,
      priceVersionSlot: "off-peak",
      reservationMicroUsd: 400,
      reservationStatus: "settled",
      settlementSource: "server-authority",
      terminalState: "completed",
    });
    expect(JSON.stringify(first.rows[0]?.receipt)).not.toContain("private source text");

    const frozen = await database.query<{
      digest: string;
      evidence: Record<string, unknown>;
    }>(`
      SELECT receipt_digest AS digest,receipt_evidence AS evidence
      FROM huayi_private.hosted_acceptance_operations
    `);
    expect(frozen.rows).toEqual([
      { digest: first.rows[0]?.receiptDigest, evidence: first.rows[0]?.receipt },
    ]);
  });

  it("rejects non-contiguous ledger evidence before freezing a receipt", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await markDispatch(database);
    await seedCompletedAnalysis(database, { callOrdinals: [0, 2] });
    await database.query(
      `SELECT huayi_private.bind_hosted_acceptance_request($1,1,$2,$3,$4,$5,$6)`,
      [operationId, operationToken, ownerId, requestId, "recovered-idempotency-key", verifier],
    );

    await expect(
      database.query(
        "SELECT * FROM huayi_private.read_and_freeze_hosted_acceptance_settlement($1,1,$2,$3)",
        [operationId, operationToken, requestId],
      ),
    ).rejects.toThrow();
    const operation = await database.query<{ digest: string | null }>(`
      SELECT receipt_digest AS digest FROM huayi_private.hosted_acceptance_operations
    `);
    expect(operation.rows).toEqual([{ digest: null }]);
  });

  it("freezes exactly two contiguous billed calls with server-recomputed totals", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await markDispatch(database);
    await seedCompletedAnalysis(database, { callOrdinals: [0, 1] });
    await database.query(
      `SELECT huayi_private.bind_hosted_acceptance_request($1,1,$2,$3,$4,$5,$6)`,
      [operationId, operationToken, ownerId, requestId, "recovered-idempotency-key", verifier],
    );

    const result = await database.query<{
      receipt: {
        billedCallCount: number;
        ledgerEntries: { callOrdinal: number; costMicroUsd: number }[];
      };
    }>(
      `SELECT receipt
       FROM huayi_private.read_and_freeze_hosted_acceptance_settlement($1,1,$2,$3)`,
      [operationId, operationToken, requestId],
    );
    expect(result.rows[0]?.receipt).toMatchObject({
      billedCallCount: 2,
      ledgerEntries: [
        { callOrdinal: 0, costMicroUsd: 32 },
        { callOrdinal: 1, costMicroUsd: 32 },
      ],
    });
  });

  it("grants only the two new fenced entrypoints and removes caller-supplied receipt digest", async () => {
    const privileges = await database.query<{ allowed: boolean; signature: string }>(`
      SELECT procedure.oid::regprocedure::text AS signature,
        has_function_privilege('huayi_hosted_acceptance_executor',procedure.oid,'EXECUTE') AS allowed
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
      WHERE namespace.nspname='huayi_private'
        AND procedure.proname IN (
          'reconcile_and_bind_hosted_acceptance_request',
          'read_and_freeze_hosted_acceptance_settlement',
          'record_hosted_acceptance_settlement'
        )
      ORDER BY signature
    `);
    expect(privileges.rows).toEqual([
      {
        allowed: true,
        signature:
          "huayi_private.read_and_freeze_hosted_acceptance_settlement(uuid,bigint,text,uuid)",
      },
      {
        allowed: true,
        signature:
          "huayi_private.reconcile_and_bind_hosted_acceptance_request(uuid,bigint,text,uuid,text,text)",
      },
      {
        allowed: true,
        signature: "huayi_private.record_hosted_acceptance_settlement(uuid,bigint,text,uuid)",
      },
    ]);
    const legacy = await database.query<{ present: boolean }>(`
      SELECT to_regprocedure(
        'huayi_private.record_hosted_acceptance_settlement(uuid,bigint,text,uuid,text)'
      ) IS NOT NULL AS present
    `);
    expect(legacy.rows).toEqual([{ present: false }]);
  });
});

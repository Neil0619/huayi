import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createHostedAcceptanceHmacKeyring,
  createHostedDeepSeekPostgresAuthority,
} from "../../../scripts/acceptance-hosted-deepseek-one-shot-postgres-authority.mjs";
import {
  applyHostedAcceptanceMigrations,
  armCleanup,
  claimOperation,
  expireOperationLease,
  insertAnalysisRequest,
  operationId,
  operationToken,
  ownerId,
  requestId,
  verifier,
} from "../test/hosted-deepseek-acceptance-authority-test-helpers.js";

describe("Hosted DeepSeek authority recovery and retention", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await applyHostedAcceptanceMigrations(database);
  });

  afterEach(async () => database.close());

  it("recovers the completed-cleanup before operation-finalization crash gap", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await database.query(
      `SELECT * FROM huayi_private.mark_hosted_acceptance_dispatch($1,1,$2,$3)`,
      [operationId, operationToken, "c".repeat(64)],
    );
    await insertAnalysisRequest(database);
    await database.query(
      `SELECT * FROM huayi_private.bind_hosted_acceptance_request($1,1,$2,$3,$4,$5,$6)`,
      [operationId, operationToken, ownerId, requestId, "recovered-idempotency-key", verifier],
    );
    await database.query(
      `SELECT * FROM huayi_private.record_hosted_acceptance_settlement($1,1,$2,$3,$4)`,
      [operationId, operationToken, requestId, "9".repeat(64)],
    );
    await expect(
      database.query(
        `SELECT * FROM huayi_private.record_hosted_acceptance_settlement($1,1,$2,$3,$4)`,
        [operationId, operationToken, requestId, "9".repeat(64)],
      ),
    ).resolves.toBeDefined();
    await expect(
      database.query(
        `SELECT * FROM huayi_private.record_hosted_acceptance_settlement($1,1,$2,$3,$4)`,
        [operationId, operationToken, requestId, "8".repeat(64)],
      ),
    ).rejects.toThrow();
    await database.query(
      `SELECT * FROM huayi_private.complete_hosted_acceptance_cleanup($1,1,$2,now())`,
      [operationId, operationToken],
    );
    await expect(
      database.query(`SELECT * FROM huayi_private.claim_hosted_acceptance_cleanup($1,$2)`, [
        "restarted_cleanup_token_00000000000000000001",
        "restarted_operation_token_0000000000000000001",
      ]),
    ).rejects.toThrow();

    await expireOperationLease(database);
    const recovery = await database.query<{
      cleanupAlreadyCompleted: boolean;
      operationLeaseGeneration: number;
    }>(
      `SELECT
        cleanup_already_completed AS "cleanupAlreadyCompleted",
        operation_lease_generation AS "operationLeaseGeneration"
       FROM huayi_private.claim_hosted_acceptance_cleanup($1,$2)`,
      [
        "restarted_cleanup_token_00000000000000000001",
        "restarted_operation_token_0000000000000000001",
      ],
    );
    expect(recovery.rows).toEqual([{ cleanupAlreadyCompleted: true, operationLeaseGeneration: 2 }]);
    await expect(
      database.query(
        `SELECT huayi_private.complete_hosted_acceptance_operation($1,2,$2,'accepted',NULL)`,
        [operationId, "restarted_operation_token_0000000000000000001"],
      ),
    ).resolves.toBeDefined();
  });

  it("rejects nullable completion and unbounded retention inputs", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await expect(
      database.query(
        `SELECT huayi_private.complete_hosted_acceptance_operation($1,1,$2,NULL,NULL)`,
        [operationId, operationToken],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(`SELECT huayi_private.complete_hosted_acceptance_cleanup($1,1,$2,NULL)`, [
        operationId,
        operationToken,
      ]),
    ).rejects.toThrow();
    await expect(
      database.query(`SELECT * FROM huayi_private.retain_hosted_acceptance_evidence(NULL)`),
    ).rejects.toThrow();
  });

  it("does not steal a live lease and recovers a pre-dispatch crash without dispatching", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await expect(
      database.query(`SELECT * FROM huayi_private.claim_hosted_acceptance_cleanup($1,$2)`, [
        "restarted_cleanup_token_00000000000000000001",
        "restarted_operation_token_0000000000000000001",
      ]),
    ).rejects.toThrow();
    await expireOperationLease(database);
    const recovery = await database.query<{ dispatchAttempted: boolean }>(
      `SELECT dispatch_attempted AS "dispatchAttempted"
       FROM huayi_private.claim_hosted_acceptance_cleanup($1,$2)`,
      [
        "restarted_cleanup_token_00000000000000000001",
        "restarted_operation_token_0000000000000000001",
      ],
    );
    expect(recovery.rows).toEqual([{ dispatchAttempted: false }]);
    await expect(
      database.query(`SELECT * FROM huayi_private.claim_hosted_acceptance_cleanup($1,$2)`, [
        "another_cleanup_token_0000000000000000000001",
        "another_operation_token_00000000000000000001",
      ]),
    ).rejects.toThrow();
  });

  it("runs production and PGlite through one adapter seam after key rotation and restart", async () => {
    const query = async (text: string, parameters: unknown[]) => database.query(text, parameters);
    const oldKey = Buffer.alloc(32, 1);
    const newKey = Buffer.alloc(32, 2);
    const firstProcess = createHostedDeepSeekPostgresAuthority({
      keyring: createHostedAcceptanceHmacKeyring({
        activeVersion: 1,
        keys: new Map([[1, oldKey]]),
      }),
      query,
      randomBytes_: () => Buffer.alloc(32, 3),
      randomUUID_: () => operationId,
    });
    const operationLease = (await firstProcess.claimOperation({
      candidateCommit: "b".repeat(40),
      confirmation: "approved",
      deployments: {
        api: { commit: "d".repeat(40), deploymentId: "dpl_apiCandidate", state: "READY" },
        web: { commit: "f".repeat(40), deploymentId: "dpl_webCandidate", state: "READY" },
      },
      maximumReservationMicroUsd: 50_000,
      payloadDigest: "c".repeat(64),
    })) as {
      claimToken: string;
      idempotencyKey: string;
      leaseGeneration: number;
      operationId: string;
    };
    await firstProcess.armCleanup({
      claimToken: operationLease.claimToken,
      deployments: {
        api: { commit: "d".repeat(40), deploymentId: "dpl_apiCandidate", state: "READY" },
        web: { commit: "f".repeat(40), deploymentId: "dpl_webCandidate", state: "READY" },
      },
      desiredKillSwitchEnabled: true,
      leaseGeneration: operationLease.leaseGeneration,
      operationId: operationLease.operationId,
    });
    await firstProcess.markDispatchAttempted({
      claimToken: operationLease.claimToken,
      leaseGeneration: operationLease.leaseGeneration,
      operationId: operationLease.operationId,
      payloadDigest: "c".repeat(64),
    });
    await expireOperationLease(database);

    const restartedProcess = createHostedDeepSeekPostgresAuthority({
      keyring: createHostedAcceptanceHmacKeyring({
        activeVersion: 2,
        keys: new Map([
          [1, oldKey],
          [2, newKey],
        ]),
      }),
      query,
      randomBytes_: () => Buffer.alloc(32, 4),
    });
    const recovery = (await restartedProcess.claimCleanup()) as {
      dispatchRecovery: {
        idempotencyKey: string;
        idempotencyVerifier: string;
        operationLease: {
          claimToken: string;
          leaseGeneration: number;
          operationId: string;
          ownerId: string;
        };
        requestId: string | null;
      };
    };
    expect(recovery.dispatchRecovery).toEqual(
      expect.objectContaining({
        idempotencyKey: operationLease.idempotencyKey,
        requestId: null,
      }),
    );
    await insertAnalysisRequest(database, requestId, recovery.dispatchRecovery.idempotencyKey);
    await expect(
      restartedProcess.bindRequest({
        claimToken: recovery.dispatchRecovery.operationLease.claimToken,
        idempotencyKey: recovery.dispatchRecovery.idempotencyKey,
        idempotencyVerifier: recovery.dispatchRecovery.idempotencyVerifier,
        leaseGeneration: recovery.dispatchRecovery.operationLease.leaseGeneration,
        operationId: recovery.dispatchRecovery.operationLease.operationId,
        ownerId: recovery.dispatchRecovery.operationLease.ownerId,
        requestId,
      }),
    ).resolves.toMatchObject({ status: "bound" });
  });

  it("fails closed for multiple pending cleanup and never retains cleanup-pending rows", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await database.exec(`
      DROP INDEX huayi_private.hosted_acceptance_one_non_terminal_operation;
      INSERT INTO huayi_private.hosted_acceptance_operations(
        id,approval_digest,candidate_commit,maximum_reservation_micro_usd,payload_digest,
        api_deployment_id,api_source_commit,web_deployment_id,web_source_commit,state,
        lease_generation,lease_token_hash,lease_expires_at,owner_user_id,
        idempotency_key_hmac,idempotency_hmac_context,idempotency_hmac_version
      ) VALUES (
        '70000000-0000-4000-8000-000000000002',repeat('9',64),repeat('b',40),50000,
        repeat('c',64),'dpl_apiOther',repeat('d',40),'dpl_webOther',repeat('f',40),
        'running',1,repeat('8',64),now()-interval '1 second','${ownerId}',repeat('7',64),
        'huayi.hosted-deepseek-one-shot.idempotency.v1',1
      );
      INSERT INTO huayi_private.hosted_acceptance_cleanup_obligations(operation_id)
      VALUES ('70000000-0000-4000-8000-000000000002');
    `);
    await expect(
      database.query(`SELECT * FROM huayi_private.claim_hosted_acceptance_cleanup($1,$2)`, [
        "restarted_cleanup_token_00000000000000000001",
        "restarted_operation_token_0000000000000000001",
      ]),
    ).rejects.toThrow();

    await database.exec(`
      DELETE FROM huayi_private.hosted_acceptance_cleanup_obligations
      WHERE operation_id='70000000-0000-4000-8000-000000000002';
      DELETE FROM huayi_private.hosted_acceptance_operations
      WHERE id='70000000-0000-4000-8000-000000000002';
      UPDATE huayi_private.hosted_acceptance_operations
      SET state='cleanup-pending',lease_token_hash=NULL,lease_expires_at=NULL,
          safe_error_code='cleanup_pending',updated_at=now()
      WHERE id='${operationId}';
    `);
    const retained = await database.query<{ deletedCount: number }>(`
      SELECT deleted_count AS "deletedCount"
      FROM huayi_private.retain_hosted_acceptance_evidence(10)
    `);
    expect(retained.rows).toEqual([{ deletedCount: 0 }]);
    const remaining = await database.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM huayi_private.hosted_acceptance_operations
      WHERE id='${operationId}'
    `);
    expect(remaining.rows).toEqual([{ count: 1 }]);
  });

  it("scrubs identity after 24 hours and deletes only terminal evidence after 90 days", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await database.query(`SELECT huayi_private.mark_hosted_acceptance_dispatch($1,1,$2,$3)`, [
      operationId,
      operationToken,
      "c".repeat(64),
    ]);
    await insertAnalysisRequest(database);
    await database.query(
      `SELECT huayi_private.bind_hosted_acceptance_request($1,1,$2,$3,$4,$5,$6)`,
      [operationId, operationToken, ownerId, requestId, "recovered-idempotency-key", verifier],
    );
    await database.query(
      `SELECT huayi_private.record_hosted_acceptance_settlement($1,1,$2,$3,$4)`,
      [operationId, operationToken, requestId, "9".repeat(64)],
    );
    await database.query(`SELECT huayi_private.complete_hosted_acceptance_cleanup($1,1,$2,now())`, [
      operationId,
      operationToken,
    ]);
    await database.query(
      `SELECT huayi_private.complete_hosted_acceptance_operation($1,1,$2,'accepted',NULL)`,
      [operationId, operationToken],
    );
    await database.exec(`
      ALTER TABLE huayi_private.hosted_acceptance_operations
        DISABLE TRIGGER hosted_acceptance_operation_state_guard;
      UPDATE huayi_private.hosted_acceptance_operations
      SET created_at=now()-interval '26 hours',
          updated_at=now()-interval '25 hours',
          terminal_at=now()-interval '25 hours',
          retention_expires_at=now()-interval '26 hours'+interval '90 days'
      WHERE id='${operationId}';
      ALTER TABLE huayi_private.hosted_acceptance_operations
        ENABLE TRIGGER hosted_acceptance_operation_state_guard;

      INSERT INTO huayi_private.hosted_acceptance_operations(
        id,approval_digest,candidate_commit,maximum_reservation_micro_usd,payload_digest,
        api_deployment_id,api_source_commit,web_deployment_id,web_source_commit,state,
        owner_user_id,idempotency_key_hmac,idempotency_hmac_context,
        idempotency_hmac_version,dispatch_attempted_at,server_request_id,receipt_digest,
        lease_generation,created_at,updated_at,terminal_at,retention_expires_at
      ) VALUES (
        '70000000-0000-4000-8000-000000000090',repeat('8',64),repeat('b',40),50000,
        repeat('c',64),'dpl_apiExpired',repeat('d',40),'dpl_webExpired',repeat('f',40),
        'terminal','${ownerId}',repeat('7',64),
        'huayi.hosted-deepseek-one-shot.idempotency.v1',1,
        now()-interval '90 days','72000000-0000-4000-8000-000000000090',repeat('6',64),
        1,now()-interval '91 days',now()-interval '90 days',now()-interval '90 days',
        now()-interval '1 day'
      );
      INSERT INTO huayi_private.hosted_acceptance_cleanup_obligations(
        operation_id,state,completed_at,armed_at,updated_at
      ) VALUES (
        '70000000-0000-4000-8000-000000000090','completed',
        now()-interval '90 days',now()-interval '90 days',now()-interval '90 days'
      );
    `);

    const result = await database.query<{ deletedCount: number; scrubbedCount: number }>(`
      SELECT
        scrubbed_count AS "scrubbedCount",
        deleted_count AS "deletedCount"
      FROM huayi_private.retain_hosted_acceptance_evidence(10)
    `);
    expect(result.rows).toEqual([{ deletedCount: 1, scrubbedCount: 1 }]);
    const evidence = await database.query<{
      ownerId: string | null;
      receiptDigest: string;
      scrubbed: boolean;
    }>(`
      SELECT
        owner_user_id::text AS "ownerId",
        receipt_digest AS "receiptDigest",
        identity_scrubbed_at IS NOT NULL AS scrubbed
      FROM huayi_private.hosted_acceptance_operations
      WHERE id='${operationId}'
    `);
    expect(evidence.rows).toEqual([
      { ownerId: null, receiptDigest: "9".repeat(64), scrubbed: true },
    ]);
  });
});

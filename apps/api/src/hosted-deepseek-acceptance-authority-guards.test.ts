import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyHostedAcceptanceMigrations,
  armCleanup,
  claimOperation,
  operationId,
  operationToken,
  ownerId,
  verifier,
} from "../test/hosted-deepseek-acceptance-authority-test-helpers.js";

describe("Hosted DeepSeek acceptance authority guards", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await applyHostedAcceptanceMigrations(database);
  });

  afterEach(async () => database.close());

  it("rejects claimed HMAC material without an explicit key version", async () => {
    await expect(
      database.query(
        `SELECT * FROM huayi_private.claim_hosted_acceptance_operation(
          $1,repeat('a',64),repeat('b',40),50000,repeat('c',64),
          'dpl_apiCandidate',repeat('d',40),'dpl_webCandidate',repeat('f',40),
          $2,NULL,$3
        )`,
        [operationId, verifier, operationToken],
      ),
    ).rejects.toThrow();
  });

  it("cannot terminalize a failed operation while cleanup is incomplete", async () => {
    await claimOperation(database);
    await armCleanup(database);

    await expect(
      database.query(
        `SELECT huayi_private.complete_hosted_acceptance_operation(
          $1,1,$2,'failed','internal_safe_failure'
        )`,
        [operationId, operationToken],
      ),
    ).rejects.toThrow();
    await expect(readOperationState(database)).resolves.toBe("running");
  });

  it("materializes a cleanup obligation when cleanup arm completion was uncertain", async () => {
    await claimOperation(database);

    await expect(
      database.query(
        `SELECT huayi_private.complete_hosted_acceptance_operation(
          $1,1,$2,'failed-cleanup-pending','cleanup_pending'
        )`,
        [operationId, operationToken],
      ),
    ).resolves.toBeDefined();
    await expect(readOperationState(database)).resolves.toBe("cleanup-pending");
    const cleanup = await database.query<{ state: string }>(`
      SELECT state
      FROM huayi_private.hosted_acceptance_cleanup_obligations
      WHERE operation_id='${operationId}'
    `);
    expect(cleanup.rows).toEqual([{ state: "pending" }]);
  });

  it("bounds identity scrubs and evidence deletions to one shared batch limit", async () => {
    await database.exec(`
      INSERT INTO huayi_private.hosted_acceptance_operations(
        id,approval_digest,candidate_commit,maximum_reservation_micro_usd,payload_digest,
        api_deployment_id,api_source_commit,web_deployment_id,web_source_commit,state,
        owner_user_id,idempotency_key_hmac,idempotency_hmac_context,idempotency_hmac_version,
        dispatch_attempted_at,server_request_id,receipt_digest,lease_generation,
        created_at,updated_at,terminal_at,retention_expires_at
      ) VALUES
      (
        '70000000-0000-4000-8000-000000000024',repeat('2',64),repeat('b',40),50000,
        repeat('c',64),'dpl_apiScrub',repeat('d',40),'dpl_webScrub',repeat('f',40),
        'terminal','${ownerId}',repeat('3',64),
        'huayi.hosted-deepseek-one-shot.idempotency.v1',1,now()-interval '25 hours',
        '72000000-0000-4000-8000-000000000024',repeat('4',64),1,
        now()-interval '26 hours',now()-interval '25 hours',now()-interval '25 hours',
        now()-interval '26 hours'+interval '90 days'
      ),
      (
        '70000000-0000-4000-8000-000000000090',repeat('5',64),repeat('b',40),50000,
        repeat('c',64),'dpl_apiDelete',repeat('d',40),'dpl_webDelete',repeat('f',40),
        'terminal','${ownerId}',repeat('6',64),
        'huayi.hosted-deepseek-one-shot.idempotency.v1',1,now()-interval '90 days',
        '72000000-0000-4000-8000-000000000090',repeat('7',64),1,
        now()-interval '91 days',now()-interval '90 days',now()-interval '90 days',
        now()-interval '1 day'
      );
    `);

    const result = await database.query<{ deletedCount: number; scrubbedCount: number }>(`
      SELECT
        scrubbed_count AS "scrubbedCount",
        deleted_count AS "deletedCount"
      FROM huayi_private.retain_hosted_acceptance_evidence(1)
    `);
    expect(result.rows).toHaveLength(1);
    const counts = result.rows[0];
    if (counts === undefined) throw new Error("retention counts are missing");
    expect(counts.scrubbedCount + counts.deletedCount).toBe(1);
  });
});

async function readOperationState(database: PGlite): Promise<string> {
  const result = await database.query<{ state: string }>(`
    SELECT state
    FROM huayi_private.hosted_acceptance_operations
    WHERE id='${operationId}'
  `);
  return result.rows[0]?.state ?? "absent";
}

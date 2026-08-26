import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const forwardUrl = new URL(
  "../migrations/0016-hosted-deepseek-acceptance-authority.sql",
  import.meta.url,
);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260827010000_hosted_deepseek_acceptance_authority.sql",
  import.meta.url,
);

const operationOne = "00000000-0000-4000-8000-000000000001";
const operationTwo = "00000000-0000-4000-8000-000000000002";

async function applyForward(database: PGlite): Promise<void> {
  await database.exec(await readFile(forwardUrl, "utf8"));
}

async function insertReadyOperation(
  database: PGlite,
  operationId: string,
  approvalDigestCharacter: string,
): Promise<void> {
  await database.query(
    `
      INSERT INTO huayi_private.hosted_acceptance_operations (
        id,
        approval_digest,
        candidate_commit,
        maximum_reservation_micro_usd,
        payload_digest,
        api_deployment_id,
        api_source_commit,
        web_deployment_id,
        web_source_commit
      ) VALUES (
        $1,
        repeat($2, 64),
        repeat('a', 40),
        50000,
        repeat('b', 64),
        'dpl_apiAcceptance',
        repeat('c', 40),
        'dpl_webAcceptance',
        repeat('d', 40)
      )
    `,
    [operationId, approvalDigestCharacter],
  );
}

describe("Hosted DeepSeek acceptance authority migration", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
    `);
    await database.exec(await readFile(baselineUrl, "utf8"));
  });

  afterEach(async () => database.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const forward = await readFile(forwardUrl, "utf8");

    await expect(readFile(supabaseForwardUrl, "utf8")).resolves.toBe(forward);
  });

  it("creates private authority rows with exact retention and structural constraints", async () => {
    await applyForward(database);
    await insertReadyOperation(database, operationOne, "1");

    const operation = await database.query<{
      retentionSeconds: number;
      state: string;
    }>(`
      SELECT
        state,
        extract(epoch FROM retention_expires_at - created_at)::integer AS "retentionSeconds"
      FROM huayi_private.hosted_acceptance_operations
      WHERE id = '${operationOne}'
    `);
    expect(operation.rows).toEqual([{ retentionSeconds: 7_776_000, state: "ready" }]);

    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_operations
          SET dispatch_attempted_at = now()
          WHERE id = $1
        `,
        [operationOne],
      ),
    ).rejects.toThrow();

    await database.query(
      `
        UPDATE huayi_private.hosted_acceptance_operations
        SET owner_user_id = '00000000-0000-4000-8000-000000000099',
            idempotency_key_hmac = repeat('e', 64),
            updated_at = now()
        WHERE id = $1
      `,
      [operationOne],
    );
    await database.query(
      `
        UPDATE huayi_private.hosted_acceptance_operations
        SET dispatch_attempted_at = now(), updated_at = now()
        WHERE id = $1
      `,
      [operationOne],
    );
    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_operations
          SET state = 'terminal',
              terminal_at = now(),
              receipt_digest = repeat('f', 64),
              updated_at = now()
          WHERE id = $1
        `,
        [operationOne],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_operations
          SET server_request_id = '00000000-0000-4000-8000-000000000098', updated_at = now()
          WHERE id = $1
        `,
        [operationOne],
      ),
    ).resolves.toBeDefined();
    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_operations
          SET retention_expires_at = created_at + interval '89 days'
          WHERE id = $1
        `,
        [operationOne],
      ),
    ).rejects.toThrow();
  });

  it("allows only one non-terminal operation under concurrent inserts", async () => {
    await applyForward(database);

    const attempts = await Promise.allSettled([
      insertReadyOperation(database, operationOne, "1"),
      insertReadyOperation(database, operationTwo, "2"),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);

    const rows = await database.query<{ id: string }>(`
      SELECT id::text FROM huayi_private.hosted_acceptance_operations
    `);
    expect(rows.rows).toHaveLength(1);

    const completedOperationId = rows.rows[0]?.id;
    expect(completedOperationId).toBeDefined();
    await database.query(
      `
        UPDATE huayi_private.hosted_acceptance_operations
        SET state = 'terminal', terminal_at = now(), updated_at = now()
        WHERE id = $1
      `,
      [completedOperationId],
    );
    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_operations
          SET lease_generation = lease_generation + 1, updated_at = now()
          WHERE id = $1
        `,
        [completedOperationId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_operations
          SET terminal_at = terminal_at + interval '1 second', updated_at = now()
          WHERE id = $1
        `,
        [completedOperationId],
      ),
    ).rejects.toThrow();
    const nextOperationId = completedOperationId === operationOne ? operationTwo : operationOne;
    const nextApprovalDigestCharacter = completedOperationId === operationOne ? "2" : "1";
    await insertReadyOperation(database, nextOperationId, nextApprovalDigestCharacter);

    const states = await database.query<{ count: number; state: string }>(`
      SELECT state, count(*)::integer AS count
      FROM huayi_private.hosted_acceptance_operations
      GROUP BY state
      ORDER BY state
    `);
    expect(states.rows).toEqual([
      { count: 1, state: "ready" },
      { count: 1, state: "terminal" },
    ]);
  });

  it("enforces one-way operation state and generation-fenced leases", async () => {
    await applyForward(database);
    await insertReadyOperation(database, operationOne, "1");
    await database.query(
      `
        UPDATE huayi_private.hosted_acceptance_operations
        SET state = 'running',
            lease_generation = 1,
            lease_token_hash = repeat('e', 64),
            lease_expires_at = now() + interval '120 seconds',
            updated_at = now()
        WHERE id = $1
      `,
      [operationOne],
    );

    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_operations
          SET lease_generation = 2, updated_at = now()
          WHERE id = $1
        `,
        [operationOne],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_operations
          SET lease_token_hash = repeat('f', 64), updated_at = now()
          WHERE id = $1
        `,
        [operationOne],
      ),
    ).rejects.toThrow();
    await database.query(
      `
        UPDATE huayi_private.hosted_acceptance_operations
        SET lease_generation = 2,
            lease_token_hash = repeat('f', 64),
            lease_expires_at = now() + interval '120 seconds',
            updated_at = now()
        WHERE id = $1
      `,
      [operationOne],
    );
    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_operations
          SET state = 'ready', updated_at = now()
          WHERE id = $1
        `,
        [operationOne],
      ),
    ).rejects.toThrow();
  });

  it("enforces independent cleanup claim generations and terminal cleanup", async () => {
    await applyForward(database);
    await insertReadyOperation(database, operationOne, "1");
    await database.query(
      `
        INSERT INTO huayi_private.hosted_acceptance_cleanup_obligations (operation_id)
        VALUES ($1)
      `,
      [operationOne],
    );
    await database.query(
      `
        UPDATE huayi_private.hosted_acceptance_cleanup_obligations
        SET state = 'claimed',
            claim_generation = 1,
            claim_token_hash = repeat('1', 64),
            claim_expires_at = now() + interval '30 seconds',
            updated_at = now()
        WHERE operation_id = $1
      `,
      [operationOne],
    );

    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_cleanup_obligations
          SET claim_generation = 2, updated_at = now()
          WHERE operation_id = $1
        `,
        [operationOne],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_cleanup_obligations
          SET claim_token_hash = repeat('2', 64), updated_at = now()
          WHERE operation_id = $1
        `,
        [operationOne],
      ),
    ).rejects.toThrow();
    await database.query(
      `
        UPDATE huayi_private.hosted_acceptance_cleanup_obligations
        SET state = 'completed',
            claim_token_hash = NULL,
            claim_expires_at = NULL,
            completed_at = now(),
            updated_at = now()
        WHERE operation_id = $1
      `,
      [operationOne],
    );
    await expect(
      database.query(
        `
          UPDATE huayi_private.hosted_acceptance_cleanup_obligations
          SET state = 'pending', completed_at = NULL, updated_at = now()
          WHERE operation_id = $1
        `,
        [operationOne],
      ),
    ).rejects.toThrow();
  });
});

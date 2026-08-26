import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const authorityUrl = new URL(
  "../migrations/0016-hosted-deepseek-acceptance-authority.sql",
  import.meta.url,
);
const forwardUrl = new URL(
  "../migrations/0017-hosted-deepseek-acceptance-retention-scrub.sql",
  import.meta.url,
);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260827020000_hosted_deepseek_acceptance_retention_scrub.sql",
  import.meta.url,
);

const ownerId = "90000000-0000-4000-8000-000000000009";

function operationId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function requestId(sequence: number): string {
  return `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

async function applyForward(database: PGlite): Promise<void> {
  await database.exec(await readFile(forwardUrl, "utf8"));
}

async function insertBoundOperation(
  database: PGlite,
  sequence: number,
  options: { receipt?: boolean } = {},
): Promise<void> {
  const receipt = options.receipt ?? true;
  await database.query(
    `
      WITH operation_clock AS (
        SELECT clock_timestamp() - interval '72 hours' AS created_at
      )
      INSERT INTO huayi_private.hosted_acceptance_operations (
        id,
        approval_digest,
        candidate_commit,
        maximum_reservation_micro_usd,
        payload_digest,
        api_deployment_id,
        api_source_commit,
        web_deployment_id,
        web_source_commit,
        owner_user_id,
        idempotency_key_hmac,
        dispatch_attempted_at,
        server_request_id,
        receipt_digest,
        safe_error_code,
        created_at,
        updated_at,
        retention_expires_at
      )
      SELECT
        $1,
        repeat($2, 64),
        repeat('a', 40),
        50000,
        repeat('b', 64),
        'dpl_apiAcceptance',
        repeat('c', 40),
        'dpl_webAcceptance',
        repeat('d', 40),
        $3,
        repeat($2, 64),
        created_at + interval '1 hour',
        $4,
        CASE WHEN $5::boolean THEN repeat('f', 64) ELSE NULL END,
        'internal_safe_failure',
        created_at,
        created_at,
        created_at + interval '90 days'
      FROM operation_clock
    `,
    [operationId(sequence), String(sequence), ownerId, requestId(sequence), receipt],
  );
}

async function terminalizeOperation(
  database: PGlite,
  sequence: number,
  ageHours: number,
): Promise<void> {
  await database.query(
    `
      WITH terminal_clock AS (
        SELECT clock_timestamp() - ($2::integer * interval '1 hour') AS terminal_at
      )
      UPDATE huayi_private.hosted_acceptance_operations operation
      SET state = 'terminal',
          terminal_at = terminal_clock.terminal_at,
          updated_at = terminal_clock.terminal_at
      FROM terminal_clock
      WHERE operation.id = $1
    `,
    [operationId(sequence), ageHours],
  );
}

async function scrubOperation(database: PGlite, sequence: number): Promise<void> {
  await database.query(
    `
      UPDATE huayi_private.hosted_acceptance_operations
      SET owner_user_id = NULL,
          idempotency_key_hmac = NULL,
          server_request_id = NULL,
          identity_scrubbed_at = clock_timestamp()
      WHERE id = $1
    `,
    [operationId(sequence)],
  );
}

async function readOperation(database: PGlite, sequence: number) {
  const result = await database.query<{
    apiDeploymentId: string;
    apiSourceCommit: string;
    createdAt: string;
    dispatchAttemptedAt: string;
    idempotencyKeyHmac: string | null;
    identityScrubbedAt: string | null;
    ownerUserId: string | null;
    receiptDigest: string;
    retentionExpiresAt: string;
    safeErrorCode: string;
    serverRequestId: string | null;
    state: string;
    terminalAt: string;
    updatedAt: string;
    webDeploymentId: string;
    webSourceCommit: string;
  }>(
    `
      SELECT
        api_deployment_id AS "apiDeploymentId",
        api_source_commit AS "apiSourceCommit",
        created_at::text AS "createdAt",
        dispatch_attempted_at::text AS "dispatchAttemptedAt",
        idempotency_key_hmac AS "idempotencyKeyHmac",
        identity_scrubbed_at::text AS "identityScrubbedAt",
        owner_user_id::text AS "ownerUserId",
        receipt_digest AS "receiptDigest",
        retention_expires_at::text AS "retentionExpiresAt",
        safe_error_code AS "safeErrorCode",
        server_request_id::text AS "serverRequestId",
        state,
        terminal_at::text AS "terminalAt",
        updated_at::text AS "updatedAt",
        web_deployment_id AS "webDeploymentId",
        web_source_commit AS "webSourceCommit"
      FROM huayi_private.hosted_acceptance_operations
      WHERE id = $1
    `,
    [operationId(sequence)],
  );
  return result.rows[0];
}

describe("Hosted DeepSeek acceptance retention scrub migration", () => {
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
    await database.exec(await readFile(authorityUrl, "utf8"));
  });

  afterEach(async () => database.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const forward = await readFile(forwardUrl, "utf8");

    await expect(readFile(supabaseForwardUrl, "utf8")).resolves.toBe(forward);
  });

  it("scrubs the complete identity once after 24 hours and retains audit evidence", async () => {
    await applyForward(database);
    await insertBoundOperation(database, 1);
    await terminalizeOperation(database, 1, 25);
    const before = await readOperation(database, 1);

    await scrubOperation(database, 1);
    const after = await readOperation(database, 1);
    const {
      idempotencyKeyHmac: beforeHmac,
      identityScrubbedAt: beforeScrubbedAt,
      ownerUserId: beforeOwner,
      serverRequestId: beforeRequest,
      ...retainedBefore
    } = before ?? {};
    const {
      idempotencyKeyHmac,
      identityScrubbedAt,
      ownerUserId,
      serverRequestId,
      ...retainedAfter
    } = after ?? {};

    expect({ beforeHmac, beforeOwner, beforeRequest }).toEqual({
      beforeHmac: "1".repeat(64),
      beforeOwner: ownerId,
      beforeRequest: requestId(1),
    });
    expect(beforeScrubbedAt).toBeNull();
    expect({ idempotencyKeyHmac, ownerUserId, serverRequestId }).toEqual({
      idempotencyKeyHmac: null,
      ownerUserId: null,
      serverRequestId: null,
    });
    expect(identityScrubbedAt).toEqual(expect.any(String));
    expect(retainedAfter).toEqual(retainedBefore);
    await expect(scrubOperation(database, 1)).rejects.toThrow();

    await expect(
      database.query(
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
            web_source_commit,
            state,
            owner_user_id,
            idempotency_key_hmac,
            dispatch_attempted_at,
            server_request_id,
            receipt_digest,
            lease_generation,
            lease_token_hash,
            lease_expires_at,
            safe_error_code,
            created_at,
            updated_at,
            terminal_at,
            retention_expires_at,
            identity_scrubbed_at
          )
          SELECT
            $1,
            repeat('9', 64),
            candidate_commit,
            maximum_reservation_micro_usd,
            payload_digest,
            api_deployment_id,
            api_source_commit,
            web_deployment_id,
            web_source_commit,
            state,
            owner_user_id,
            idempotency_key_hmac,
            dispatch_attempted_at,
            server_request_id,
            receipt_digest,
            lease_generation,
            lease_token_hash,
            lease_expires_at,
            safe_error_code,
            created_at,
            updated_at,
            terminal_at,
            retention_expires_at,
            identity_scrubbed_at
          FROM huayi_private.hosted_acceptance_operations
          WHERE id = $2
        `,
        [operationId(2), operationId(1)],
      ),
    ).rejects.toThrow("hosted acceptance identity cannot be inserted as scrubbed");
  });

  it("rejects early, future, partial, receipt-free, and non-terminal scrubs", async () => {
    await applyForward(database);
    await insertBoundOperation(database, 1);
    await terminalizeOperation(database, 1, 23);
    await expect(scrubOperation(database, 1)).rejects.toThrow();

    await insertBoundOperation(database, 2, { receipt: false });
    await terminalizeOperation(database, 2, 25);
    await expect(scrubOperation(database, 2)).rejects.toThrow();

    await insertBoundOperation(database, 3);
    await terminalizeOperation(database, 3, 25);
    const invalidAssignments = [
      "owner_user_id = NULL, idempotency_key_hmac = NULL, identity_scrubbed_at = clock_timestamp()",
      "server_request_id = NULL, identity_scrubbed_at = clock_timestamp()",
      "owner_user_id = NULL, idempotency_key_hmac = NULL, server_request_id = NULL",
      "owner_user_id = NULL, idempotency_key_hmac = NULL, server_request_id = NULL, identity_scrubbed_at = clock_timestamp() + interval '1 second'",
    ];
    for (const assignment of invalidAssignments) {
      await expect(
        database.query(
          `UPDATE huayi_private.hosted_acceptance_operations SET ${assignment} WHERE id = $1`,
          [operationId(3)],
        ),
      ).rejects.toThrow();
    }

    await insertBoundOperation(database, 4);
    await expect(scrubOperation(database, 4)).rejects.toThrow();
  });

  it("keeps every retained field and scrub marker immutable", async () => {
    await applyForward(database);
    await insertBoundOperation(database, 1);
    await terminalizeOperation(database, 1, 25);
    await scrubOperation(database, 1);
    const scrubbed = await readOperation(database, 1);
    const invalidAssignments = [
      `owner_user_id = '${ownerId}', idempotency_key_hmac = repeat('e', 64), server_request_id = '${requestId(1)}'`,
      "identity_scrubbed_at = identity_scrubbed_at + interval '1 second'",
      "receipt_digest = NULL",
      "receipt_digest = repeat('0', 64)",
      "api_deployment_id = 'dpl_otherAcceptance'",
      "safe_error_code = NULL",
      "updated_at = updated_at + interval '1 second'",
      "terminal_at = terminal_at + interval '1 second'",
      "created_at = created_at - interval '1 second'",
      "retention_expires_at = retention_expires_at + interval '1 day'",
      "dispatch_attempted_at = dispatch_attempted_at + interval '1 second'",
    ];
    for (const assignment of invalidAssignments) {
      await expect(
        database.query(
          `UPDATE huayi_private.hosted_acceptance_operations SET ${assignment} WHERE id = $1`,
          [operationId(1)],
        ),
      ).rejects.toThrow();
    }
    expect(await readOperation(database, 1)).toEqual(scrubbed);
  });

  it("preserves private ACLs and adds no callable retention executor", async () => {
    await applyForward(database);
    const functions = await database.query<{ name: string }>(`
      SELECT routine.proname AS name
      FROM pg_proc routine
      JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'huayi_private'
        AND routine.proname LIKE 'enforce_hosted_acceptance_%'
      ORDER BY routine.proname
    `);
    expect(functions.rows).toEqual([
      { name: "enforce_hosted_acceptance_cleanup_state" },
      { name: "enforce_hosted_acceptance_operation_state" },
    ]);

    const access = await database.query<{ executeAccess: boolean; tableAccess: boolean }>(`
      SELECT
        has_function_privilege(
          role_name,
          'huayi_private.enforce_hosted_acceptance_operation_state()',
          'EXECUTE'
        ) AS "executeAccess",
        has_table_privilege(
          role_name,
          'huayi_private.hosted_acceptance_operations',
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS "tableAccess"
      FROM unnest(ARRAY[
        'anon',
        'authenticated',
        'service_role',
        'huayi_business',
        'huayi_context_setter',
        'huayi_runtime',
        'huayi_hosted_acceptance_executor'
      ]) role_name
    `);
    expect(access.rows).toHaveLength(7);
    expect(access.rows.every((row) => !row.executeAccess && !row.tableAccess)).toBe(true);
  });
});

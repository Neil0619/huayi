import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyHostedAcceptanceMigrations,
  armCleanup,
  claimOperation,
  expireOperationLease,
  forwardUrl,
  insertAnalysisRequest,
  operationId,
  operationToken,
  ownerId,
  requestId,
  supabaseForwardUrl,
  verifier,
} from "../test/hosted-deepseek-acceptance-authority-test-helpers.js";

describe("Hosted DeepSeek acceptance authority mutations", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await applyHostedAcceptanceMigrations(database);
  });

  afterEach(async () => database.close());

  it("keeps the API and Supabase forward migration byte-identical", async () => {
    await expect(readFile(supabaseForwardUrl, "utf8")).resolves.toBe(
      await readFile(forwardUrl, "utf8"),
    );
  });

  it("exposes only fixed SECURITY DEFINER functions to the executor role", async () => {
    const functions = [
      "claim_hosted_acceptance_operation(uuid,text,text,bigint,text,text,text,text,text,text,integer,text)",
      "arm_hosted_acceptance_cleanup(uuid,bigint,text,text)",
      "mark_hosted_acceptance_dispatch(uuid,bigint,text,text)",
      "bind_hosted_acceptance_request(uuid,bigint,text,uuid,uuid,text,text)",
      "record_hosted_acceptance_settlement(uuid,bigint,text,uuid,text)",
      "complete_hosted_acceptance_operation(uuid,bigint,text,text,text)",
      "claim_hosted_acceptance_cleanup(text,text)",
      "complete_hosted_acceptance_cleanup(uuid,bigint,text,timestamptz)",
      "retain_hosted_acceptance_evidence(integer)",
    ];
    for (const functionName of functions) {
      const result = await database.query<{ allowed: boolean }>(`
        SELECT has_function_privilege(
          'huayi_hosted_acceptance_executor',
          'huayi_private.${functionName}',
          'EXECUTE'
        ) AS allowed
      `);
      expect(result.rows).toEqual([{ allowed: true }]);
      const denied = await database.query<{ allowed: boolean; roleName: string }>(`
        SELECT role_name AS "roleName",has_function_privilege(
          role_name,
          'huayi_private.${functionName}',
          'EXECUTE'
        ) AS allowed
        FROM unnest(ARRAY[
          'anon','authenticated','service_role','huayi_business',
          'huayi_context_setter','huayi_runtime'
        ]) role_name
        ORDER BY role_name
      `);
      expect(denied.rows.every(({ allowed }) => !allowed)).toBe(true);
    }
    const definitions = await database.query<{
      fixedSearchPath: boolean;
      securityDefiner: boolean;
    }>(`
      SELECT
        bool_and(procedure.prosecdef) AS "securityDefiner",
        bool_and(procedure.proconfig @> ARRAY['search_path=pg_catalog, huayi_private'])
          AS "fixedSearchPath"
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
      WHERE namespace.nspname='huayi_private'
        AND procedure.proname IN (
          'claim_hosted_acceptance_operation',
          'arm_hosted_acceptance_cleanup',
          'mark_hosted_acceptance_dispatch',
          'bind_hosted_acceptance_request',
          'record_hosted_acceptance_settlement',
          'complete_hosted_acceptance_operation',
          'claim_hosted_acceptance_cleanup',
          'complete_hosted_acceptance_cleanup',
          'retain_hosted_acceptance_evidence'
        )
    `);
    expect(definitions.rows).toEqual([{ fixedSearchPath: true, securityDefiner: true }]);
    const helpers = await database.query<{ allowed: boolean }>(`
      SELECT bool_or(has_function_privilege(
        'huayi_hosted_acceptance_executor',procedure.oid,'EXECUTE'
      )) AS allowed
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
      WHERE namespace.nspname='huayi_private'
        AND procedure.proname IN (
          'hosted_acceptance_token_hash',
          'enforce_hosted_acceptance_operation_state',
          'enforce_hosted_acceptance_cleanup_state'
        )
    `);
    expect(helpers.rows).toEqual([{ allowed: false }]);
    const tableAccess = await database.query<{ allowed: boolean }>(`
      SELECT has_table_privilege(
        'huayi_hosted_acceptance_executor',
        'huayi_private.hosted_acceptance_operations',
        'SELECT,INSERT,UPDATE,DELETE'
      ) AS allowed
    `);
    expect(tableAccess.rows).toEqual([{ allowed: false }]);
  });

  it("atomically consumes one approval and rejects stale operation fencing", async () => {
    const attempts = await Promise.allSettled([claimOperation(database), claimOperation(database)]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    await armCleanup(database);

    await expect(
      database.query(`SELECT * FROM huayi_private.mark_hosted_acceptance_dispatch($1,1,$2,$3)`, [
        operationId,
        "stale_operation_token_000000000000000000",
        "c".repeat(64),
      ]),
    ).rejects.toThrow();
    await expect(
      database.query(`SELECT * FROM huayi_private.mark_hosted_acceptance_dispatch($1,1,$2,$3)`, [
        operationId,
        operationToken,
        "c".repeat(64),
      ]),
    ).resolves.toBeDefined();
  });

  it("keeps the effective fuse open only for the live running plus pending arm shape", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await database.exec(`
      INSERT INTO public.runtime_controls(name,enabled,updated_at)
      VALUES ('model_kill_switch',false,now());
    `);
    const result = await database.query<{ enabled: boolean; state: string }>(`
      SELECT
        huayi_private.effective_model_kill_switch_enabled() AS enabled,
        (SELECT state FROM huayi_private.hosted_acceptance_cleanup_obligations) AS state
    `);
    expect(result.rows).toEqual([{ enabled: false, state: "pending" }]);
  });

  it("recovers dispatch-before-bind across processes and refuses a second dispatch marker", async () => {
    await claimOperation(database);
    await armCleanup(database);
    await database.query(
      `SELECT * FROM huayi_private.mark_hosted_acceptance_dispatch($1,1,$2,$3)`,
      [operationId, operationToken, "c".repeat(64)],
    );
    await expireOperationLease(database);

    const recovered = await database.query<{
      dispatchAttempted: boolean;
      idempotencyHmacContext: string;
      idempotencyHmacVersion: number;
      operationLeaseGeneration: number;
      requestId: string | null;
    }>(
      `SELECT
        dispatch_attempted AS "dispatchAttempted",
        idempotency_hmac_context AS "idempotencyHmacContext",
        idempotency_hmac_version AS "idempotencyHmacVersion",
        operation_lease_generation AS "operationLeaseGeneration",
        server_request_id::text AS "requestId"
      FROM huayi_private.claim_hosted_acceptance_cleanup($1,$2)`,
      [
        "restarted_cleanup_token_00000000000000000001",
        "restarted_operation_token_0000000000000000001",
      ],
    );
    expect(recovered.rows).toMatchObject([
      {
        dispatchAttempted: true,
        idempotencyHmacContext: "huayi.hosted-deepseek-one-shot.idempotency.v1",
        idempotencyHmacVersion: 1,
        operationLeaseGeneration: 2,
        requestId: null,
      },
    ]);

    await expect(
      database.query(`SELECT * FROM huayi_private.mark_hosted_acceptance_dispatch($1,2,$2,$3)`, [
        operationId,
        "restarted_operation_token_0000000000000000001",
        "c".repeat(64),
      ]),
    ).rejects.toThrow();
    await insertAnalysisRequest(database);
    await expect(
      database.query(
        `SELECT * FROM huayi_private.bind_hosted_acceptance_request(
          $1,2,$2,$3,$4,$5,$6
        )`,
        [
          operationId,
          "restarted_operation_token_0000000000000000001",
          ownerId,
          requestId,
          "wrong-idempotency-key",
          verifier,
        ],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `SELECT * FROM huayi_private.bind_hosted_acceptance_request(
          $1,2,$2,$3,$4,$5,$6
        )`,
        [
          operationId,
          "restarted_operation_token_0000000000000000001",
          ownerId,
          requestId,
          "recovered-idempotency-key",
          verifier,
        ],
      ),
    ).resolves.toBeDefined();
    await expect(
      database.query(
        `SELECT * FROM huayi_private.bind_hosted_acceptance_request(
          $1,2,$2,$3,$4,$5,$6
        )`,
        [
          operationId,
          "restarted_operation_token_0000000000000000001",
          "71000000-0000-4000-8000-000000000099",
          "72000000-0000-4000-8000-000000000099",
          "recovered-idempotency-key",
          verifier,
        ],
      ),
    ).rejects.toThrow();
  });
});

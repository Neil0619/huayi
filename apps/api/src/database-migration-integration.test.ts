import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { allTenantTables, tenantTables } from "./tenant-tables.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";

function tenantFixtureSql(userId: string, suffix: "a" | "b"): string {
  return `
    INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
    VALUES ('${userId}', '${userId}', '${suffix}@example.test', 'active', 'Asia/Shanghai', 5);
    INSERT INTO account_sign_in_methods (owner_user_id, method)
    VALUES ('${userId}', 'password');
    INSERT INTO web_sessions (
      id, user_id, owner_user_id, session_hash, csrf_hash, refresh_ciphertext, expires_at
    ) VALUES (
      '01000000-0000-0000-0000-00000000000${suffix}', '${userId}', '${userId}',
      'session-${suffix}', 'csrf-${suffix}', 'refresh-${suffix}', now() + interval '1 day'
    );
    INSERT INTO account_data_export_jobs (id, owner_user_id, state)
    VALUES ('01100000-0000-0000-0000-00000000000${suffix}', '${userId}', 'pending');
    INSERT INTO extension_sessions (
      id, user_id, owner_user_id, install_id_hash, token_hash, device_label, expires_at
    ) VALUES (
      '02000000-0000-0000-0000-00000000000${suffix}', '${userId}', '${userId}',
      'install-${suffix}', 'token-${suffix}', 'Device ${suffix}', now() + interval '1 day'
    );
    INSERT INTO extension_pairings (
      id, user_id, owner_user_id, state_hash, pkce_challenge, install_id_hash, device_label,
      status, expires_at
    ) VALUES (
      '03000000-0000-0000-0000-00000000000${suffix}', '${userId}', '${userId}',
      'state-${suffix}', 'challenge-${suffix}', 'install-${suffix}', 'Device ${suffix}',
      'approved', now() + interval '10 minutes'
    );
    INSERT INTO study_captures (
      id,owner_user_id,selection_kind,source_text,normalized_text_hash,status,
      first_captured_at,last_captured_at
    ) VALUES (
      '03500000-0000-0000-0000-00000000000${suffix}','${userId}','sentence',
      'Private capture ${suffix}.',repeat('${suffix}',64),'pending',now(),now()
    );
    INSERT INTO analysis_records (
      id, owner_user_id, review_state, source_type, source_text, selection_kind, result,
      model_metadata,source_normalized_hash
    ) VALUES (
      '04000000-0000-0000-0000-00000000000${suffix}', '${userId}', 'pendingReview',
      'manual', 'Private sentence ${suffix}.', 'sentence', '{}', '{}',repeat('${suffix}',64)
    );
    INSERT INTO analysis_candidates (
      id, analysis_id, owner_user_id, candidate_type, payload, analysis_unit_id, ordinal
    ) VALUES (
      '05000000-0000-0000-0000-00000000000${suffix}',
      '04000000-0000-0000-0000-00000000000${suffix}', '${userId}',
      'expression', '{}', 'u1', 0
    );
    INSERT INTO idempotency_records (
      owner_user_id, operation, key, request_hash, response, expires_at
    ) VALUES ('${userId}', 'fixture', 'key-${suffix}', 'hash-${suffix}', '{}', now() + interval '1 day');
    INSERT INTO analysis_requests (
      id, owner_user_id, idempotency_key, request_hash, unit_count, state, lease_token,
      lease_expires_at, recovery_ledger_id
    ) VALUES (
      '05100000-0000-0000-0000-00000000000${suffix}', '${userId}', 'analysis-${suffix}',
      repeat('${suffix}', 64), 1, 'running', 'lease-${suffix}', now()+interval '2 minutes',
      '05200000-0000-0000-0000-00000000000${suffix}'
    );
    INSERT INTO extension_query_generations (
      id,owner_user_id,idempotency_key,request_hash,state,request,lease_token,
      lease_expires_at,expires_at
    ) VALUES (
      '05300000-0000-0000-0000-00000000000${suffix}','${userId}','query-${suffix}',
      repeat('${suffix}',64),'running','{}','query-lease-${suffix}',now()+interval '2 minutes',
      now()+interval '1 hour'
    );
    INSERT INTO learning_items (
      id, owner_user_id, type, canonical_key, content, system_attributes
    ) VALUES (
      '06000000-0000-0000-0000-00000000000${suffix}', '${userId}', 'expression',
      'expression-${suffix}', '{}', '[]'
    );
    INSERT INTO source_examples (
      id, owner_user_id, learning_item_id, analysis_id, analysis_unit_id, source_text, source_type
    ) VALUES (
      '07000000-0000-0000-0000-00000000000${suffix}', '${userId}',
      '06000000-0000-0000-0000-00000000000${suffix}',
      '04000000-0000-0000-0000-00000000000${suffix}', 'u1',
      'Private source ${suffix}.', 'manual'
    );
    INSERT INTO tags (id, owner_user_id, normalized_name, display_name)
    VALUES (
      '08000000-0000-0000-0000-00000000000${suffix}', '${userId}', 'tag-${suffix}', 'Tag ${suffix}'
    );
    INSERT INTO learning_item_tags (learning_item_id, tag_id, owner_user_id)
    VALUES (
      '06000000-0000-0000-0000-00000000000${suffix}',
      '08000000-0000-0000-0000-00000000000${suffix}', '${userId}'
    );
    INSERT INTO schedule_states (learning_item_id, owner_user_id, level, due_at)
    VALUES ('06000000-0000-0000-0000-00000000000${suffix}', '${userId}', -1, NULL);
    INSERT INTO word_entries (id, owner_user_id, headword, canonical_key)
    VALUES (
      '09000000-0000-0000-0000-00000000000${suffix}', '${userId}',
      'word-${suffix}', 'word-${suffix}'
    );
    INSERT INTO context_observations (
      id, owner_user_id, word_entry_id, content_hash, source_text, source_type, observed_at
    ) VALUES (
      '10000000-0000-0000-0000-00000000000${suffix}', '${userId}',
      '09000000-0000-0000-0000-00000000000${suffix}', 'context-${suffix}',
      'Word context ${suffix}.', 'manual', now()
    );
    INSERT INTO external_wordbook_jobs (id, owner_user_id, target, direction, state)
    VALUES (
      '11000000-0000-0000-0000-00000000000${suffix}', '${userId}', 'eudic', 'export', 'pending'
    );
    INSERT INTO external_wordbook_items (
      id, owner_user_id, job_id, word_entry_id, payload_snapshot, state
    ) VALUES (
      '12000000-0000-0000-0000-00000000000${suffix}', '${userId}',
      '11000000-0000-0000-0000-00000000000${suffix}',
      '09000000-0000-0000-0000-00000000000${suffix}',
      jsonb_build_object('headword','word-${suffix}'), 'pending'
    );
    INSERT INTO practice_sessions (id, owner_user_id, type, status, prompt)
    VALUES (
      '13000000-0000-0000-0000-00000000000${suffix}', '${userId}',
      'sentence-creation', 'active', 'Write one sentence.'
    );
    INSERT INTO practice_session_items (
      session_id, learning_item_id, owner_user_id, position, schedule_before
    ) VALUES (
      '13000000-0000-0000-0000-00000000000${suffix}',
      '06000000-0000-0000-0000-00000000000${suffix}', '${userId}', 0, '{}'
    );
    INSERT INTO practice_turns (id, session_id, owner_user_id, ordinal, role, content)
    VALUES (
      '14000000-0000-0000-0000-00000000000${suffix}',
      '13000000-0000-0000-0000-00000000000${suffix}', '${userId}', 0, 'user', 'My answer.'
    );
    INSERT INTO practice_attempts (id, session_id, owner_user_id, answer, submitted_at)
    VALUES (
      '14100000-0000-0000-0000-00000000000${suffix}',
      '13000000-0000-0000-0000-00000000000${suffix}', '${userId}', 'My attempt.', now()
    );
    INSERT INTO practice_generation_tasks (id,owner_user_id,session_id,attempt_id,kind,state,request_hash,lease_token,lease_expires_at) VALUES ('14200000-0000-0000-0000-00000000000${suffix}','${userId}','13000000-0000-0000-0000-00000000000${suffix}','14100000-0000-0000-0000-00000000000${suffix}','sentence-feedback','claimed',repeat('${suffix}',64),'generation-${suffix}',now()+interval '2 minutes');
    INSERT INTO quota_grants (
      id, user_id, owner_user_id, period_start, period_end, limit_micro_usd, source
    ) VALUES (
      '15000000-0000-0000-0000-00000000000${suffix}', '${userId}', '${userId}',
      date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', 1000, 'default'
    );
    INSERT INTO quota_reservations (
      id, user_id, owner_user_id, request_id, period_start, reserved_micro_usd, status, expires_at
    ) VALUES (
      '16000000-0000-0000-0000-00000000000${suffix}', '${userId}', '${userId}',
      '17000000-0000-0000-0000-00000000000${suffix}', date_trunc('month', now()),
      100, 'active', now() + interval '2 minutes'
    );
    INSERT INTO usage_ledger (
      id, user_id, owner_user_id, request_id, call_ordinal, period_start, feature,
      price_version_id, cost_micro_usd, outcome
    ) VALUES (
      '18000000-0000-0000-0000-00000000000${suffix}', '${userId}', '${userId}',
      '19000000-0000-0000-0000-00000000000${suffix}', 0, date_trunc('month', now()),
      'analysis', '20000000-0000-0000-0000-000000000001', 10, 'succeeded'
    );
  `;
}

describe("Cloud V1 migration in embedded PostgreSQL", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => database.close());

  it("executes and creates a forced policy for every tenant table", async () => {
    const roles = await database.query<{
      rolbypassrls: boolean;
      rolinherit: boolean;
      rolname: string;
    }>("SELECT rolname, rolinherit, rolbypassrls FROM pg_roles WHERE rolname = 'huayi_business'");
    expect(roles.rows).toEqual([
      { rolbypassrls: false, rolinherit: false, rolname: "huayi_business" },
    ]);

    const protectedTables = await database.query<{
      relforcerowsecurity: boolean;
      relname: string;
      relrowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relname = ANY($1::text[])
       ORDER BY relname`,
      [[...allTenantTables]],
    );
    expect(protectedTables.rows).toHaveLength(allTenantTables.length);
    expect(
      protectedTables.rows.every((table) => table.relrowsecurity && table.relforcerowsecurity),
    ).toBe(true);

    const policies = await database.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies
       WHERE tablename = ANY($1::text[])
       ORDER BY tablename`,
      [[...allTenantTables]],
    );
    expect(policies.rows.map((policy) => policy.tablename)).toEqual([...allTenantTables].sort());
  });

  it("lets the business role see only the owner fixed by trusted transaction context", async () => {
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES
        ('${userA}', '${userA}', 'a@example.test', 'active', 'Asia/Shanghai', 5),
        ('${userB}', '${userB}', 'b@example.test', 'active', 'Asia/Shanghai', 5);
      INSERT INTO analysis_records (
        id, owner_user_id, review_state, source_type, source_text, selection_kind, result,
        model_metadata,source_normalized_hash
      ) VALUES
        ('10000000-0000-0000-0000-00000000000a', '${userA}', 'pendingReview', 'manual',
         'A private sentence.', 'sentence', '{}', '{}',repeat('a',64)),
        ('10000000-0000-0000-0000-00000000000b', '${userB}', 'pendingReview', 'manual',
         'B private sentence.', 'sentence', '{}', '{}',repeat('b',64));
    `);

    await database.transaction(async (transaction) => {
      await transaction.exec(`SELECT huayi_private.set_owner_context('${userA}')`);
      await transaction.exec("SET LOCAL ROLE huayi_business");
      const visible = await transaction.query<{ source_text: string }>(
        "SELECT source_text FROM analysis_records ORDER BY source_text",
      );
      expect(visible.rows).toEqual([{ source_text: "A private sentence." }]);
      await expect(
        transaction.exec(
          `UPDATE analysis_records SET source_text = 'stolen' WHERE owner_user_id = '${userB}'`,
        ),
      ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ affectedRows: 0 })]));
    });
  });

  it("applies the cross-tenant read and write matrix to every tenant table", async () => {
    await database.exec(`
      INSERT INTO model_price_versions (
        id, provider, model, input_micro_usd_per_million,
        cached_input_micro_usd_per_million, output_micro_usd_per_million, effective_from
      ) VALUES (
        '20000000-0000-0000-0000-000000000001', 'deepseek', 'fixture-model', 1, 1, 1, now()
      );
      ${tenantFixtureSql(userA, "a")}
      ${tenantFixtureSql(userB, "b")}
    `);

    await database.transaction(async (transaction) => {
      await transaction.exec(`SELECT huayi_private.set_owner_context('${userA}')`);
      await transaction.exec("SET LOCAL ROLE huayi_business");
      for (const table of tenantTables) {
        const visible = await transaction.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM ${table}`,
        );
        expect(visible.rows, table).toEqual([{ count: 1 }]);
      }
    });

    for (const table of tenantTables) {
      await expect(
        database.transaction(async (transaction) => {
          await transaction.exec(`SELECT huayi_private.set_owner_context('${userA}')`);
          await transaction.exec("SET LOCAL ROLE huayi_business");
          await transaction.exec(
            `UPDATE ${table} SET owner_user_id = '${userB}' WHERE owner_user_id = '${userA}'`,
          );
        }),
        table,
      ).rejects.toThrow();
    }
  });

  it("prevents the business role from choosing or replacing owner context", async () => {
    await database.transaction(async (transaction) => {
      await transaction.exec("SET LOCAL ROLE huayi_business");
      await expect(
        transaction.exec(`SELECT huayi_private.set_owner_context('${userB}')`),
      ).rejects.toThrow();
    });

    await database.transaction(async (transaction) => {
      await transaction.exec(`SELECT huayi_private.set_owner_context('${userA}')`);
      await transaction.exec(`SELECT huayi_private.set_owner_context('${userB}')`);
      const owner = await transaction.query<{ owner: string }>(
        "SELECT huayi_private.current_owner_user_id()::text AS owner",
      );
      expect(owner.rows).toEqual([{ owner: userA }]);
    });
  });

  it("keeps price and ledger rows immutable outside the account-deletion transaction", async () => {
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userA}', '${userA}', 'a@example.test', 'active', 'Asia/Shanghai', 5);
      INSERT INTO model_price_versions (
        id, provider, model, input_micro_usd_per_million,
        cached_input_micro_usd_per_million, output_micro_usd_per_million, effective_from
      ) VALUES (
        '20000000-0000-0000-0000-000000000001', 'deepseek', 'test-model', 1, 1, 1, now()
      );
      INSERT INTO usage_ledger (
        id, user_id, owner_user_id, request_id, call_ordinal, period_start, feature,
        price_version_id, cost_micro_usd, outcome
      ) VALUES (
        '30000000-0000-0000-0000-000000000001', '${userA}', '${userA}',
        '40000000-0000-0000-0000-000000000001', 0, date_trunc('month', now()), 'analysis',
        '20000000-0000-0000-0000-000000000001', 1, 'succeeded'
      );
    `);

    await expect(database.exec("DELETE FROM model_price_versions")).rejects.toThrow();
    await expect(database.exec("DELETE FROM usage_ledger")).rejects.toThrow();
    await database.transaction(async (transaction) => {
      await transaction.exec("SELECT set_config('huayi.account_deletion', 'on', true)");
      await transaction.exec(`DELETE FROM usage_ledger WHERE user_id = '${userA}'`);
    });
    const remaining = await database.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM usage_ledger",
    );
    expect(remaining.rows).toEqual([{ count: 0 }]);
  });

  it("claims and finalizes one invitation idempotently", async () => {
    const invitationId = "21000000-0000-0000-0000-000000000001";
    await database.exec(`
      INSERT INTO invitations (id, token_hash, expires_at, created_by)
      VALUES ('${invitationId}', 'token-hash', now() + interval '72 hours', '${userA}');
    `);
    const first = await database.query<{ id: string | null }>(
      "SELECT claim_invitation('token-hash', 'ticket-a', now() + interval '15 minutes')::text AS id",
    );
    const second = await database.query<{ id: string | null }>(
      "SELECT claim_invitation('token-hash', 'ticket-b', now() + interval '15 minutes')::text AS id",
    );
    expect(first.rows).toEqual([{ id: invitationId }]);
    expect(second.rows).toEqual([{ id: null }]);

    await database.exec(`SELECT bind_auth_identity('ticket-a', '${userA}')`);

    const finalized = await database.query<{ id: string | null }>(
      `SELECT finalize_invitation('ticket-a', '${userA}', 'a@example.test', 'Asia/Shanghai', 5, 'password')::text AS id`,
    );
    const replay = await database.query<{ id: string | null }>(
      `SELECT finalize_invitation('ticket-a', '${userA}', 'a@example.test', 'Asia/Shanghai', 5, 'password')::text AS id`,
    );
    const conflict = await database.query<{ id: string | null }>(
      `SELECT finalize_invitation('ticket-a', '${userB}', 'b@example.test', 'Asia/Shanghai', 5, 'password')::text AS id`,
    );
    expect(finalized.rows).toEqual([{ id: userA }]);
    expect(replay.rows).toEqual([{ id: userA }]);
    expect(conflict.rows).toEqual([{ id: null }]);
  });

  it("allows a new claim after the previous claim expires", async () => {
    const invitationId = "21300000-0000-0000-0000-000000000001";
    await database.exec(`
      INSERT INTO invitations (id, token_hash, expires_at, created_by)
      VALUES ('${invitationId}', 'retry-token-hash', now() + interval '72 hours', '${userA}');
      SELECT claim_invitation('retry-token-hash', 'expired-ticket', now() - interval '1 second');
    `);
    const retry = await database.query<{ id: string | null }>(`
      SELECT claim_invitation(
        'retry-token-hash', 'replacement-ticket', now() + interval '15 minutes'
      )::text AS id
    `);
    expect(retry.rows).toEqual([{ id: invitationId }]);
  });

  it("keeps claim tickets out of callback URLs through one-time auth flows", async () => {
    const invitationId = "21100000-0000-0000-0000-000000000001";
    await database.exec(`
      INSERT INTO invitations (id, token_hash, expires_at, created_by)
      VALUES ('${invitationId}', 'flow-token-hash', now() + interval '72 hours', '${userA}');
      SELECT claim_invitation('flow-token-hash', 'claim-ticket-hash', now() + interval '15 minutes');
    `);
    const created = await database.query<{ id: string | null }>(`
      SELECT create_auth_flow(
        'claim-ticket-hash', 'opaque-flow-id-hash', now() + interval '15 minutes'
      ) AS id
    `);
    expect(created.rows).toEqual([{ id: "opaque-flow-id-hash" }]);
    const consumed = await database.query<{ ticket: string | null }>(`
      SELECT consume_auth_flow('opaque-flow-id-hash') AS ticket
    `);
    const replay = await database.query<{ ticket: string | null }>(`
      SELECT consume_auth_flow('opaque-flow-id-hash') AS ticket
    `);
    expect(consumed.rows).toEqual([{ ticket: "claim-ticket-hash" }]);
    expect(replay.rows).toEqual([{ ticket: null }]);

    const bound = await database.query<{ id: string | null }>(`
      SELECT bind_auth_identity('claim-ticket-hash', '${userA}')::text AS id
    `);
    const wrongFinalization = await database.query<{ id: string | null }>(`
      SELECT finalize_invitation(
        'claim-ticket-hash', '${userB}', 'b@example.test', 'UTC', 5, 'password'
      )::text AS id
    `);
    expect(bound.rows).toEqual([{ id: userA }]);
    expect(wrongFinalization.rows).toEqual([{ id: null }]);
  });
});

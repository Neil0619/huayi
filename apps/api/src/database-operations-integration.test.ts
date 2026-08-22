import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";

describe("Cloud V1 operational transactions in embedded PostgreSQL", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => database.close());

  it("rejects a claimed invitation that is revoked before identity binding", async () => {
    const invitationId = "22100000-0000-0000-0000-000000000001";
    await database.exec(`
      INSERT INTO invitations (id, token_hash, expires_at, created_by)
      VALUES ('${invitationId}', 'revoked-token', now() + interval '72 hours', '${userA}');
      SELECT claim_invitation('revoked-token', 'revoked-ticket', now() + interval '15 minutes');
      UPDATE invitations SET revoked_at = now() WHERE id = '${invitationId}';
    `);
    const required = await database.query<{ expires_at: Date | null }>(
      "SELECT require_claim_ticket('revoked-ticket') AS expires_at",
    );
    const bound = await database.query<{ id: string | null }>(
      `SELECT bind_auth_identity('revoked-ticket', '${userA}')::text AS id`,
    );
    expect(required.rows).toEqual([{ expires_at: null }]);
    expect(bound.rows).toEqual([{ id: null }]);
  });

  it("creates, approves, and exchanges an extension pairing exactly once", async () => {
    const pairingId = "22000000-0000-0000-0000-000000000001";
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userA}', '${userA}', 'a@example.test', 'active', 'Asia/Shanghai', 5);
      SELECT create_extension_pairing(
        '${pairingId}', 'state-hash', 'challenge-hash', 'install-hash',
        now() + interval '10 minutes'
      );
      SELECT approve_extension_pairing(
        '${pairingId}','${userA}','Work Mac',1,'byok','automatic','disabled'
      );
    `);
    const first = await database.query<{
      cloud_word_copy_mode: string;
      extension_query_model_mode: string;
      id: string;
      preferences_revision: number;
      study_capture_mode: string;
    }>(`SELECT id::text,extension_query_model_mode,study_capture_mode,
      cloud_word_copy_mode,preferences_revision FROM exchange_extension_pairing(
      '${pairingId}', 'state-hash', 'challenge-hash',
      '23000000-0000-0000-0000-000000000001', 'session-token-hash',
      now() + interval '90 days')`);
    const second = await database.query<{ id: string }>(`SELECT id::text
      FROM exchange_extension_pairing(
      '${pairingId}', 'state-hash', 'challenge-hash',
      '23000000-0000-0000-0000-000000000002', 'other-token-hash',
      now() + interval '90 days')`);
    expect(first.rows).toEqual([
      {
        cloud_word_copy_mode: "disabled",
        extension_query_model_mode: "byok",
        id: "23000000-0000-0000-0000-000000000001",
        preferences_revision: 2,
        study_capture_mode: "automatic",
      },
    ]);
    expect(second.rows).toEqual([]);
    const preferences = await database.query(`SELECT extension_query_model_mode,
      study_capture_mode,cloud_word_copy_mode,preferences_revision
      FROM user_profiles WHERE user_id='${userA}'`);
    expect(preferences.rows).toEqual([
      {
        cloud_word_copy_mode: "disabled",
        extension_query_model_mode: "byok",
        preferences_revision: 2,
        study_capture_mode: "automatic",
      },
    ]);
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userB}', '${userB}', 'b@example.test', 'active', 'Asia/Shanghai', 5);
    `);
    const listed = await database.query<{ id: string }>(
      `SELECT id::text FROM list_extension_sessions('${userA}')`,
    );
    await database.exec(`INSERT INTO extension_sessions(
      id,user_id,owner_user_id,install_id_hash,token_hash,device_label,expires_at
    ) VALUES(
      '23000000-0000-0000-0000-000000000002','${userA}','${userA}','second-install',
      'other-token-hash','Home Mac',now()+interval '90 days'
    )`);
    const unknownSelfRevoke = await database.query<{ revoked: boolean }>(
      "SELECT revoke_current_extension_session('unknown-token-hash') AS revoked",
    );
    const selfRevoked = await database.query<{ revoked: boolean }>(
      "SELECT revoke_current_extension_session('session-token-hash') AS revoked",
    );
    const selfReplay = await database.query<{ revoked: boolean }>(
      "SELECT revoke_current_extension_session('session-token-hash') AS revoked",
    );
    const afterSelf = await database.query<{ id: string }>(
      `SELECT id::text FROM list_extension_sessions('${userA}')`,
    );
    const crossAccount = await database.query<{ revoked: boolean | null }>(
      `SELECT revoke_extension_session(
        '${userB}', '23000000-0000-0000-0000-000000000002'
      ) AS revoked`,
    );
    const revoked = await database.query<{ revoked: boolean | null }>(
      `SELECT revoke_extension_session(
        '${userA}', '23000000-0000-0000-0000-000000000002'
      ) AS revoked`,
    );
    const after = await database.query<{ id: string }>(
      `SELECT id::text FROM list_extension_sessions('${userA}')`,
    );
    expect(listed.rows).toEqual([{ id: "23000000-0000-0000-0000-000000000001" }]);
    expect(unknownSelfRevoke.rows).toEqual([{ revoked: false }]);
    expect(selfRevoked.rows).toEqual([{ revoked: true }]);
    expect(selfReplay.rows).toEqual([{ revoked: false }]);
    expect(afterSelf.rows).toEqual([{ id: "23000000-0000-0000-0000-000000000002" }]);
    expect(crossAccount.rows).toEqual([{ revoked: null }]);
    expect(revoked.rows).toEqual([{ revoked: true }]);
    expect(after.rows).toEqual([]);
  });

  it("rolls back a pairing exchange when the owner preference snapshot is unavailable", async () => {
    const pairingId = "22000000-0000-0000-0000-000000000003";
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userA}', '${userA}', 'a@example.test', 'active', 'Asia/Shanghai', 5);
      SELECT create_extension_pairing(
        '${pairingId}', 'state-hash', 'challenge-hash', 'install-hash',
        now() + interval '10 minutes'
      );
      SELECT approve_extension_pairing(
        '${pairingId}','${userA}','Work Mac',1,'byok','automatic','disabled'
      );
      UPDATE user_profiles SET status='disabled' WHERE user_id='${userA}';
    `);

    await expect(
      database.query(`SELECT * FROM exchange_extension_pairing(
        '${pairingId}', 'state-hash', 'challenge-hash',
        '23000000-0000-0000-0000-000000000003', 'session-token-hash',
        now() + interval '90 days')`),
    ).rejects.toThrow(/profile unavailable/iu);
    await expect(
      database.query(`SELECT status,
        (SELECT count(*)::int FROM extension_sessions) session_count
        FROM extension_pairings WHERE id='${pairingId}'`),
    ).resolves.toMatchObject({ rows: [{ session_count: 0, status: "approved" }] });
  });

  it("preserves quota grant history and blocks reservations under the kill switch", async () => {
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userA}', '${userA}', 'a@example.test', 'active', 'Asia/Shanghai', 5);
      SELECT replace_quota_grant(
        '24000000-0000-0000-0000-000000000001', '${userA}',
        date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC',
        1000, 'default'
      );
      SELECT replace_quota_grant(
        '24000000-0000-0000-0000-000000000002', '${userA}',
        date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC',
        2000, 'admin'
      );
    `);
    const grants = await database.query<{
      limit_micro_usd: string;
      superseded_at: string | null;
    }>(
      "SELECT limit_micro_usd::text, superseded_at::text FROM quota_grants ORDER BY created_at, id",
    );
    expect(grants.rows).toHaveLength(2);
    expect(grants.rows[0]?.superseded_at).not.toBeNull();
    expect(grants.rows[1]).toMatchObject({ limit_micro_usd: "2000", superseded_at: null });
    await database.exec(`INSERT INTO runtime_controls (name, enabled, updated_by)
      VALUES ('model_kill_switch', true, '${userA}')`);
    await expect(
      database.exec(`SELECT reserve_quota(
      '25000000-0000-0000-0000-000000000001', '${userA}',
      '26000000-0000-0000-0000-000000000001', 100, now() + interval '2 minutes'
    )`),
    ).rejects.toThrow(/model unavailable/iu);
  });

  it("reserves quota only through the trusted transaction function", async () => {
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userA}', '${userA}', 'a@example.test', 'active', 'Asia/Shanghai', 5);
      INSERT INTO model_price_versions (
        id, provider, model, input_micro_usd_per_million,
        cached_input_micro_usd_per_million, output_micro_usd_per_million, effective_from
      ) VALUES ('20000000-0000-0000-0000-000000000001', 'deepseek', 'quota-test', 1, 1, 1, now());
      SELECT replace_quota_grant(
        '27000000-0000-0000-0000-000000000001', '${userA}',
        date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC',
        1000, 'default'
      );
    `);
    await expect(
      database.query(`SELECT require_model_price_version(
        '20000000-0000-0000-0000-000000000001', 'deepseek', 'quota-test', 1, 1, 1
      )`),
    ).resolves.toBeDefined();
    await expect(
      database.query(`SELECT require_model_price_version(
        '20000000-0000-0000-0000-000000000001', 'deepseek', 'quota-test', 0, 1, 1
      )`),
    ).rejects.toThrow(/model price mismatch/iu);
    const reservation = await database.query<{ id: string }>(`SELECT reserve_quota(
      '28000000-0000-0000-0000-000000000001', '${userA}',
      '29000000-0000-0000-0000-000000000001', 100, now() + interval '2 minutes'
    )::text AS id`);
    expect(reservation.rows).toEqual([{ id: "28000000-0000-0000-0000-000000000001" }]);
    await database.exec(`SELECT settle_quota_reservation(
      '28000000-0000-0000-0000-000000000001',
      ARRAY['28100000-0000-0000-0000-000000000001']::uuid[], 'analysis',
      '20000000-0000-0000-0000-000000000001',
      '[{"costMicroUsd":50,"inputTokens":10,"cachedInputTokens":0,"outputTokens":5}]'::jsonb,
      'succeeded'
    )`);
    await expect(
      database.exec(`SELECT reserve_quota(
      '28200000-0000-0000-0000-000000000001', '${userA}',
      '29000000-0000-0000-0000-000000000001', 100, now() + interval '2 minutes'
    )`),
    ).rejects.toThrow(/idempotency conflict/iu);
    await expect(
      database.transaction(async (transaction) => {
        await transaction.exec(`SELECT huayi_private.set_owner_context('${userA}')`);
        await transaction.exec("SET LOCAL ROLE huayi_business");
        await transaction.exec(`INSERT INTO usage_ledger (
        id, user_id, owner_user_id, request_id, call_ordinal, period_start, feature,
        price_version_id, cost_micro_usd, outcome
      ) VALUES (
        '30000000-0000-0000-0000-000000000002', '${userA}', '${userA}',
        '31000000-0000-0000-0000-000000000001', 0, date_trunc('month', now()),
        'analysis', '20000000-0000-0000-0000-000000000001', 1, 'succeeded'
      )`);
      }),
    ).rejects.toThrow();
  });

  it("atomically enforces bounded rate-limit windows", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        database.query<{ allowed: boolean }>(`SELECT consume_rate_limit(
        'subject-hash', 'pairing-poll', date_trunc('minute', now()), 3
      ) AS allowed`),
      ),
    );
    const rows = attempts.flatMap((attempt) => attempt.rows);
    expect(rows.filter((row) => row.allowed)).toHaveLength(3);
    expect(rows.filter((row) => !row.allowed)).toHaveLength(1);
  });

  it("commits each administrator change with a content-free audit event", async () => {
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userA}', '${userA}', 'a@example.test', 'active', 'UTC', 5),
        ('${userB}', '${userB}', 'b@example.test', 'active', 'UTC', 5);
      INSERT INTO admin_roles (user_id, role) VALUES ('${userA}', 'operator');
      SELECT admin_create_invitation(
        '32000000-0000-0000-0000-000000000001', 'admin-token-hash',
        now() + interval '72 hours', '${userA}', '33000000-0000-0000-0000-000000000001'
      );
      SELECT admin_set_quota(
        '${userA}', '${userB}', '34000000-0000-0000-0000-000000000001',
        date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC',
        5000, '35000000-0000-0000-0000-000000000001'
      );
      SELECT admin_set_user_status(
        '${userA}', '${userB}', 'disabled', '36000000-0000-0000-0000-000000000001'
      );
      SELECT admin_revoke_devices(
        '${userA}', '${userB}', '37000000-0000-0000-0000-000000000001'
      );
    `);
    const events = await database.query<{ action: string; safe_details: Record<string, unknown> }>(
      "SELECT action, safe_details FROM audit_events ORDER BY created_at, id",
    );
    expect(events.rows).toEqual([
      { action: "invitation.created", safe_details: {} },
      { action: "quota.granted", safe_details: { limitMicroUsd: 5000 } },
      { action: "user.disabled", safe_details: {} },
      { action: "devices.revoked", safe_details: { revokedCount: 0 } },
    ]);
    expect(JSON.stringify(events.rows)).not.toMatch(/sourceText|cookie|csrf|token|email/iu);
    await expect(
      database.exec(`SELECT admin_set_user_status(
      '${userB}', '${userA}', 'disabled', '38000000-0000-0000-0000-000000000001'
    )`),
    ).rejects.toThrow(/administrator required/iu);
  });
});

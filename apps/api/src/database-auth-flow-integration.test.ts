import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";

describe("Cloud V1 auth-flow identity fencing", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => database.close());

  it("does not consume an auth flow when the bound identity conflicts", async () => {
    const invitationId = "21200000-0000-0000-0000-000000000001";
    await database.exec(`
      INSERT INTO invitations (id, token_hash, expires_at, created_by)
      VALUES ('${invitationId}', 'bound-token-hash', now() + interval '72 hours', '${userA}');
      SELECT claim_invitation('bound-token-hash', 'bound-ticket-hash', now() + interval '15 minutes');
      SELECT create_auth_flow(
        'bound-ticket-hash', 'bound-flow-hash', now() + interval '15 minutes'
      );
      SELECT bind_auth_identity('bound-ticket-hash', '${userA}');
    `);
    const conflict = await database.query<{ id: string | null }>(`
      SELECT complete_auth_flow(
        'bound-flow-hash', '${userB}', 'b@example.test', 'UTC', 5
      )::text AS id
    `);
    const retry = await database.query<{ id: string | null }>(`
      SELECT complete_auth_flow(
        'bound-flow-hash', '${userA}', 'a@example.test', 'UTC', 5
      )::text AS id
    `);
    expect(conflict.rows).toEqual([{ id: null }]);
    expect(retry.rows).toEqual([{ id: userA }]);
  });

  it("registers only Google for an invitation flow and fences ordinary login by method", async () => {
    const invitationId = "21400000-0000-0000-0000-000000000001";
    await database.exec(`
      INSERT INTO invitations (id, token_hash, expires_at, created_by)
      VALUES ('${invitationId}', 'google-token-hash', now() + interval '72 hours', '${userA}');
      SELECT claim_invitation(
        'google-token-hash', 'google-ticket-hash', now() + interval '15 minutes'
      );
      SELECT create_auth_flow(
        'google-ticket-hash', 'google-flow-hash', now() + interval '15 minutes'
      );
    `);
    const registration = await database.query<{ id: string | null }>(`
      SELECT complete_auth_flow(
        'google-flow-hash', '${userA}', 'a@example.test', 'UTC', 5
      )::text AS id
    `);
    const methods = await database.query<{ method: string }>(`
      SELECT method FROM account_sign_in_methods WHERE owner_user_id='${userA}' ORDER BY method
    `);
    const password = await database.query<{ id: string | null }>(`
      SELECT authorize_sign_in_method('${userA}', 'password')::text AS id
    `);
    const google = await database.query<{ id: string | null }>(`
      SELECT authorize_sign_in_method('${userA}', 'google')::text AS id
    `);

    expect(registration.rows).toEqual([{ id: userA }]);
    expect(methods.rows).toEqual([{ method: "google" }]);
    expect(password.rows).toEqual([{ id: null }]);
    expect(google.rows).toEqual([{ id: userA }]);
  });

  it("does not consume an invitation or add a method for an existing profile", async () => {
    const invitationId = "21500000-0000-0000-0000-000000000001";
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userA}', '${userA}', 'a@example.test', 'active', 'UTC', 5);
      INSERT INTO account_sign_in_methods (owner_user_id, method)
      VALUES ('${userA}', 'password');
      INSERT INTO invitations (id, token_hash, expires_at, created_by)
      VALUES ('${invitationId}', 'existing-token-hash', now() + interval '72 hours', '${userB}');
      SELECT claim_invitation(
        'existing-token-hash', 'existing-ticket-hash', now() + interval '15 minutes'
      );
      SELECT bind_auth_identity('existing-ticket-hash', '${userA}');
    `);
    const finalized = await database.query<{ id: string | null }>(`
      SELECT finalize_invitation(
        'existing-ticket-hash', '${userA}', 'a@example.test', 'UTC', 5, 'google'
      )::text AS id
    `);
    const invitation = await database.query<{ consumed: boolean }>(`
      SELECT consumed_at IS NOT NULL AS consumed FROM invitations WHERE id='${invitationId}'
    `);
    const methods = await database.query<{ method: string }>(`
      SELECT method FROM account_sign_in_methods WHERE owner_user_id='${userA}' ORDER BY method
    `);

    expect(finalized.rows).toEqual([{ id: null }]);
    expect(invitation.rows).toEqual([{ consumed: false }]);
    expect(methods.rows).toEqual([{ method: "password" }]);
  });

  it("authorizes registered methods for active and disabled accounts but not deleting accounts", async () => {
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userA}', '${userA}', 'a@example.test', 'active', 'UTC', 5);
      INSERT INTO account_sign_in_methods (owner_user_id, method)
      VALUES ('${userA}', 'password');
    `);
    const active = await database.query<{ id: string | null }>(`
      SELECT authorize_sign_in_method('${userA}', 'password')::text AS id
    `);
    await database.exec(`UPDATE user_profiles SET status='disabled' WHERE user_id='${userA}'`);
    const disabled = await database.query<{ id: string | null }>(`
      SELECT authorize_sign_in_method('${userA}', 'password')::text AS id
    `);
    await database.exec(`UPDATE user_profiles SET status='deleting' WHERE user_id='${userA}'`);
    const deleting = await database.query<{ id: string | null }>(`
      SELECT authorize_sign_in_method('${userA}', 'password')::text AS id
    `);

    expect(active.rows).toEqual([{ id: userA }]);
    expect(disabled.rows).toEqual([{ id: userA }]);
    expect(deleting.rows).toEqual([{ id: null }]);
  });

  it("does not let the ordinary business role directly add a sign-in method", async () => {
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userA}', '${userA}', 'a@example.test', 'active', 'UTC', 5);
      INSERT INTO account_sign_in_methods (owner_user_id, method)
      VALUES ('${userA}', 'password');
    `);

    await expect(
      database.transaction(async (transaction) => {
        await transaction.exec(`SELECT huayi_private.set_owner_context('${userA}')`);
        await transaction.exec("SET LOCAL ROLE huayi_business");
        await transaction.exec(`
          INSERT INTO account_sign_in_methods (owner_user_id, method)
          VALUES ('${userA}', 'google')
        `);
      }),
    ).rejects.toThrow();
    const methods = await database.query<{ method: string }>(`
      SELECT method FROM account_sign_in_methods WHERE owner_user_id='${userA}' ORDER BY method
    `);
    expect(methods.rows).toEqual([{ method: "password" }]);
  });

  it("prepares password reauthentication and atomically rotates only the same owner session", async () => {
    const oldSessionId = "21600000-0000-0000-0000-000000000001";
    const mismatchedSessionId = "21600000-0000-0000-0000-000000000002";
    const newSessionId = "21600000-0000-0000-0000-000000000003";
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userA}', '${userA}', 'learner@example.test', 'active', 'UTC', 5);
      INSERT INTO account_sign_in_methods (owner_user_id, method)
      VALUES ('${userA}', 'password');
      INSERT INTO web_sessions (
        id, user_id, owner_user_id, session_hash, csrf_hash, refresh_ciphertext, expires_at
      ) VALUES (
        '${oldSessionId}', '${userA}', '${userA}', 'old-session-hash', 'old-csrf-hash',
        'old-refresh-ciphertext', now() + interval '30 days'
      );
    `);
    const prepared = await database.query<{
      csrf_hash: string;
      email: string;
      user_id: string;
    }>(`SELECT user_id::text,email,csrf_hash
       FROM prepare_password_reauthentication('old-session-hash')`);
    expect(prepared.rows).toEqual([
      { csrf_hash: "old-csrf-hash", email: "learner@example.test", user_id: userA },
    ]);

    const mismatch = await database.query<{ id: string | null }>(`
      SELECT id::text FROM rotate_password_reauthenticated_session(
        'old-session-hash', '${userB}', '${mismatchedSessionId}', 'mismatch-hash',
        'mismatch-csrf', 'mismatch-refresh', now() + interval '30 days'
      )
    `);
    expect(mismatch.rows).toEqual([]);
    const unchanged = await database.query<{ revoked: boolean }>(`
      SELECT revoked_at IS NOT NULL AS revoked FROM web_sessions WHERE id='${oldSessionId}'
    `);
    expect(unchanged.rows).toEqual([{ revoked: false }]);

    const rotated = await database.query<{ access_scope: string; id: string }>(`
      SELECT id::text,access_scope FROM rotate_password_reauthenticated_session(
        'old-session-hash', '${userA}', '${newSessionId}', 'new-session-hash',
        'new-csrf-hash', 'new-refresh-ciphertext', now() + interval '30 days'
      )
    `);
    expect(rotated.rows).toEqual([{ access_scope: "full", id: newSessionId }]);
    const sessions = await database.query<{
      id: string;
      reauthenticated_method: string | null;
      refresh_ciphertext: string;
      revoked: boolean;
    }>(`
      SELECT id::text,reauthenticated_method,refresh_ciphertext,revoked_at IS NOT NULL AS revoked
      FROM web_sessions WHERE user_id='${userA}' ORDER BY id
    `);
    expect(sessions.rows).toEqual([
      {
        id: oldSessionId,
        reauthenticated_method: null,
        refresh_ciphertext: "old-refresh-ciphertext",
        revoked: true,
      },
      {
        id: newSessionId,
        reauthenticated_method: "password",
        refresh_ciphertext: "new-refresh-ciphertext",
        revoked: false,
      },
    ]);

    const replay = await database.query<{ id: string }>(`
      SELECT id::text FROM rotate_password_reauthenticated_session(
        'old-session-hash', '${userA}', '${mismatchedSessionId}', 'replay-hash',
        'replay-csrf', 'replay-refresh', now() + interval '30 days'
      )
    `);
    expect(replay.rows).toEqual([]);
  });

  it("binds Google reauthentication to one purpose, session, and provider user", async () => {
    const oldSessionId = "21700000-0000-0000-0000-000000000001";
    const newSessionId = "21700000-0000-0000-0000-000000000002";
    await database.exec(`
      INSERT INTO user_profiles (user_id, owner_user_id, email, status, timezone, daily_goal)
      VALUES ('${userA}', '${userA}', 'learner@example.test', 'active', 'UTC', 5);
      INSERT INTO account_sign_in_methods (owner_user_id, method) VALUES ('${userA}', 'google');
      INSERT INTO web_sessions (
        id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,expires_at
      ) VALUES (
        '${oldSessionId}','${userA}','${userA}','google-old-hash','google-csrf-hash',
        'google-old-refresh',now() + interval '30 days'
      );
    `);
    const rejected = await database.query<{ id: string | null }>(`
      SELECT create_google_reauthentication(
        'rejected-flow','google-old-hash','wrong-csrf',now() + interval '15 minutes'
      )::text AS id
    `);
    expect(rejected.rows).toEqual([{ id: null }]);
    const created = await database.query<{ id: string }>(`
      SELECT create_google_reauthentication(
        'google-flow','google-old-hash','google-csrf-hash',now() + interval '15 minutes'
      )::text AS id
    `);
    expect(created.rows).toEqual([{ id: userA }]);
    const continued = await database.query<{ id: string }>(`
      SELECT continue_google_reauthentication('google-flow','google-old-hash')::text AS id
    `);
    const replayContinue = await database.query<{ id: string | null }>(`
      SELECT continue_google_reauthentication('google-flow','google-old-hash')::text AS id
    `);
    expect(continued.rows).toEqual([{ id: userA }]);
    expect(replayContinue.rows).toEqual([{ id: null }]);
    await database.exec(`SELECT save_auth_flow_state('google-flow','protected-provider-state')`);
    const mismatch = await database.query<{ id: string }>(`
      SELECT id::text FROM complete_google_reauthentication(
        'google-flow','google-old-hash','${userB}','21700000-0000-0000-0000-000000000009',
        'mismatch-hash','mismatch-csrf','mismatch-refresh',now() + interval '30 days'
      )
    `);
    expect(mismatch.rows).toEqual([]);
    const consumedMismatch = await database.query<{ consumed: boolean }>(`
      SELECT consumed_at IS NOT NULL AS consumed FROM auth_flows WHERE flow_hash='google-flow'
    `);
    expect(consumedMismatch.rows).toEqual([{ consumed: true }]);
    const unchanged = await database.query<{ revoked: boolean }>(`
      SELECT revoked_at IS NOT NULL AS revoked FROM web_sessions WHERE id='${oldSessionId}'
    `);
    expect(unchanged.rows).toEqual([{ revoked: false }]);

    await database.exec(`
      SELECT create_google_reauthentication(
        'google-flow-2','google-old-hash','google-csrf-hash',now() + interval '15 minutes'
      );
      SELECT continue_google_reauthentication('google-flow-2','google-old-hash');
      SELECT save_auth_flow_state('google-flow-2','protected-provider-state-2');
    `);
    const completed = await database.query<{ access_scope: string; id: string }>(`
      SELECT id::text,access_scope FROM complete_google_reauthentication(
        'google-flow-2','google-old-hash','${userA}','${newSessionId}',
        'google-new-hash','google-new-csrf','google-new-refresh',now() + interval '30 days'
      )
    `);
    expect(completed.rows).toEqual([{ access_scope: "full", id: newSessionId }]);
    const sessions = await database.query<{
      id: string;
      reauthenticated_method: string | null;
      revoked: boolean;
    }>(`
      SELECT id::text,reauthenticated_method,revoked_at IS NOT NULL AS revoked FROM web_sessions
      WHERE user_id='${userA}' ORDER BY id
    `);
    expect(sessions.rows).toEqual([
      { id: oldSessionId, reauthenticated_method: null, revoked: true },
      { id: newSessionId, reauthenticated_method: "google", revoked: false },
    ]);
    const recent = await database.query<{ id: string | null }>(`
      SELECT require_recent_authentication('google-new-hash','google')::text AS id
    `);
    const wrongMethod = await database.query<{ id: string | null }>(`
      SELECT require_recent_authentication('google-new-hash','password')::text AS id
    `);
    expect(recent.rows).toEqual([{ id: userA }]);
    expect(wrongMethod.rows).toEqual([{ id: null }]);
  });
});

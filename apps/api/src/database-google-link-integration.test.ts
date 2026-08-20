import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userId = "00000000-0000-0000-0000-00000000000a";

describe("Cloud V1 Google link state machine", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    await database.exec(`
      INSERT INTO user_profiles (user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES ('${userId}','${userId}','learner@example.test','active','UTC',5);
      INSERT INTO account_sign_in_methods(owner_user_id,method)
      VALUES ('${userId}','password');
      INSERT INTO web_sessions (
        id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,
        reauthenticated_method,expires_at
      ) VALUES
      (
        '21800000-0000-0000-0000-000000000001','${userId}','${userId}',
        'current-session-hash','current-csrf-hash','current-refresh','password',
        now() + interval '30 days'
      ),
      (
        '21800000-0000-0000-0000-000000000002','${userId}','${userId}',
        'other-session-hash','other-csrf-hash','other-refresh',NULL,
        now() + interval '30 days'
      );
      INSERT INTO extension_sessions(
        id,user_id,owner_user_id,install_id_hash,token_hash,device_label,expires_at
      ) VALUES (
        '21800000-0000-0000-0000-000000000003','${userId}','${userId}',
        'install-hash','extension-token-hash','MacBook',now() + interval '30 days'
      );
    `);
  });

  afterEach(async () => database.close());

  it("leases one refresh generation, recovers expiry, and completes with global revocation", async () => {
    const wrongCsrf = await database.query<{ id: string | null; status: string }>(`
      SELECT user_id::text AS id,status FROM create_google_link(
        'wrong-csrf-flow','current-session-hash','wrong-csrf',now() + interval '15 minutes'
      )
    `);
    expect(wrongCsrf.rows).toEqual([]);

    const created = await database.query<{ id: string | null; status: string }>(`
      SELECT user_id::text AS id,status FROM create_google_link(
        'google-link-flow','current-session-hash','current-csrf-hash',
        now() + interval '15 minutes'
      )
    `);
    const duplicate = await database.query<{ id: string | null; status: string }>(`
      SELECT user_id::text AS id,status FROM create_google_link(
        'duplicate-flow','current-session-hash','current-csrf-hash',
        now() + interval '15 minutes'
      )
    `);
    expect(created.rows).toEqual([{ id: userId, status: "created" }]);
    expect(duplicate.rows).toEqual([]);

    const claimed = await database.query<{
      provider_state_ciphertext: string | null;
      refresh_ciphertext: string | null;
      stage: string;
      user_id: string;
    }>(`
      SELECT user_id::text,stage,refresh_ciphertext,provider_state_ciphertext
      FROM claim_google_link_continuation(
        'google-link-flow','current-session-hash','lease-1',now() + interval '30 seconds'
      )
    `);
    const competing = await database.query<{ user_id: string }>(`
      SELECT user_id::text FROM claim_google_link_continuation(
        'google-link-flow','current-session-hash','lease-2',now() + interval '30 seconds'
      )
    `);
    expect(claimed.rows).toEqual([
      {
        provider_state_ciphertext: null,
        refresh_ciphertext: "current-refresh",
        stage: "claimed",
        user_id: userId,
      },
    ]);
    expect(competing.rows).toEqual([]);

    await database.exec(`
      UPDATE auth_flows SET link_lease_expires_at=now() - interval '1 second'
      WHERE flow_hash='google-link-flow'
    `);
    const recovered = await database.query<{ stage: string }>(`
      SELECT stage FROM claim_google_link_continuation(
        'google-link-flow','current-session-hash','lease-3',now() + interval '30 seconds'
      )
    `);
    expect(recovered.rows).toEqual([{ stage: "claimed" }]);

    const refreshed = await database.query<{ saved: boolean | null }>(`
      SELECT save_google_link_refresh(
        'google-link-flow','current-session-hash','lease-3','${userId}',
        'rotated-refresh','protected-refreshed-state'
      ) AS saved
    `);
    const wrongLease = await database.query<{ saved: boolean | null }>(`
      SELECT save_google_link_provider_started(
        'google-link-flow','current-session-hash','wrong-lease','protected-started-state'
      ) AS saved
    `);
    const started = await database.query<{ saved: boolean | null }>(`
      SELECT save_google_link_provider_started(
        'google-link-flow','current-session-hash','lease-3','protected-started-state'
      ) AS saved
    `);
    expect(refreshed.rows).toEqual([{ saved: true }]);
    expect(wrongLease.rows).toEqual([{ saved: null }]);
    expect(started.rows).toEqual([{ saved: true }]);

    const state = await database.query<{ state: string | null }>(`
      SELECT read_google_link_state('google-link-flow','current-session-hash') AS state
    `);
    expect(state.rows).toEqual([{ state: "protected-started-state" }]);

    const completed = await database.query<{ access_scope: string; id: string }>(`
      SELECT id::text,access_scope FROM complete_google_link(
        'google-link-flow','current-session-hash','${userId}',
        '21800000-0000-0000-0000-000000000004','linked-session-hash','linked-csrf-hash',
        'linked-refresh',now() + interval '30 days'
      )
    `);
    expect(completed.rows).toEqual([
      { access_scope: "full", id: "21800000-0000-0000-0000-000000000004" },
    ]);

    const methods = await database.query<{ method: string }>(`
      SELECT method FROM account_sign_in_methods WHERE owner_user_id='${userId}' ORDER BY method
    `);
    const sessions = await database.query<{ id: string; revoked: boolean }>(`
      SELECT id::text,revoked_at IS NOT NULL AS revoked FROM web_sessions
      WHERE user_id='${userId}' ORDER BY id
    `);
    const extensions = await database.query<{ revoked: boolean }>(`
      SELECT revoked_at IS NOT NULL AS revoked FROM extension_sessions WHERE user_id='${userId}'
    `);
    expect(methods.rows).toEqual([{ method: "google" }, { method: "password" }]);
    expect(sessions.rows).toEqual([
      { id: "21800000-0000-0000-0000-000000000001", revoked: true },
      { id: "21800000-0000-0000-0000-000000000002", revoked: true },
      { id: "21800000-0000-0000-0000-000000000004", revoked: false },
    ]);
    expect(extensions.rows).toEqual([{ revoked: true }]);

    const replay = await database.query<{ id: string }>(`
      SELECT id::text FROM complete_google_link(
        'google-link-flow','current-session-hash','${userId}',
        '21800000-0000-0000-0000-000000000005','replay-hash','replay-csrf',
        'replay-refresh',now() + interval '30 days'
      )
    `);
    expect(replay.rows).toEqual([]);
  });

  it("distinguishes an already linked method after validating the current session proof", async () => {
    await database.exec(`
      INSERT INTO account_sign_in_methods(owner_user_id,method) VALUES ('${userId}','google')
    `);
    const linked = await database.query<{ status: string; user_id: string }>(`
      SELECT user_id::text,status FROM create_google_link(
        'unused-flow','current-session-hash','current-csrf-hash',now() + interval '15 minutes'
      )
    `);
    const wrongProof = await database.query<{ status: string; user_id: string }>(`
      SELECT user_id::text,status FROM create_google_link(
        'wrong-proof-flow','current-session-hash','wrong-csrf',now() + interval '15 minutes'
      )
    `);
    const flows = await database.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM auth_flows WHERE kind='link-google'
    `);
    expect(linked.rows).toEqual([{ status: "already-linked", user_id: userId }]);
    expect(wrongProof.rows).toEqual([]);
    expect(flows.rows).toEqual([{ count: 0 }]);
  });
});

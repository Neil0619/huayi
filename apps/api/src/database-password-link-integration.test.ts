import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userId = "00000000-0000-0000-0000-00000000000a";
const otherUserId = "00000000-0000-0000-0000-00000000000b";

describe("Cloud V1 password link state machine", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES ('${userId}','${userId}','learner@example.test','active','UTC',5);
      INSERT INTO account_sign_in_methods(owner_user_id,method) VALUES ('${userId}','google');
      INSERT INTO web_sessions(
        id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,
        reauthenticated_method,expires_at
      ) VALUES
      (
        '21900000-0000-0000-0000-000000000001','${userId}','${userId}',
        'current-session-hash','current-csrf-hash','current-refresh','google',
        now() + interval '30 days'
      ),
      (
        '21900000-0000-0000-0000-000000000002','${userId}','${userId}',
        'other-session-hash','other-csrf-hash','other-refresh',NULL,
        now() + interval '30 days'
      );
      INSERT INTO extension_sessions(
        id,user_id,owner_user_id,install_id_hash,token_hash,device_label,expires_at
      ) VALUES (
        '21900000-0000-0000-0000-000000000003','${userId}','${userId}',
        'install-hash','extension-token-hash','MacBook',now() + interval '30 days'
      );
    `);
  });

  afterEach(async () => database.close());

  it("persists refresh before password update and resumes completed provider work", async () => {
    const claimed = await database.query<{
      flow_hash: string;
      refresh_ciphertext: string | null;
      stage: string;
      user_id: string;
    }>(`
      SELECT flow_hash,user_id::text,stage,refresh_ciphertext
      FROM claim_password_link(
        'current-session-hash','current-csrf-hash','password-flow','lease-1',
        now() + interval '30 seconds',now() + interval '15 minutes'
      )
    `);
    expect(claimed.rows).toEqual([
      {
        flow_hash: "password-flow",
        refresh_ciphertext: "current-refresh",
        stage: "claimed",
        user_id: userId,
      },
    ]);

    const wrongUser = await database.query<{ saved: boolean | null }>(`
      SELECT save_password_link_refresh(
        'password-flow','current-session-hash','lease-1','${otherUserId}',
        'untrusted-refresh','untrusted-state'
      ) AS saved
    `);
    const refreshed = await database.query<{ saved: boolean | null }>(`
      SELECT save_password_link_refresh(
        'password-flow','current-session-hash','lease-1','${userId}',
        'rotated-refresh','protected-refreshed-state'
      ) AS saved
    `);
    expect(wrongUser.rows).toEqual([{ saved: null }]);
    expect(refreshed.rows).toEqual([{ saved: true }]);
    const persisted = await database.query<{
      password_stored: boolean;
      refresh_ciphertext: string;
      stage: string;
    }>(`
      SELECT sessions.refresh_ciphertext,flows.link_stage AS stage,
        flows.provider_state_ciphertext LIKE '%correct horse%' AS password_stored
      FROM auth_flows AS flows JOIN web_sessions AS sessions
        ON sessions.session_hash=flows.web_session_hash
      WHERE flows.flow_hash='password-flow'
    `);
    expect(persisted.rows).toEqual([
      { password_stored: false, refresh_ciphertext: "rotated-refresh", stage: "refreshed" },
    ]);

    const updated = await database.query<{ saved: boolean | null }>(`
      SELECT save_password_link_provider_updated(
        'password-flow','current-session-hash','lease-1','${userId}'
      ) AS saved
    `);
    expect(updated.rows).toEqual([{ saved: true }]);
    await database.exec(`
      UPDATE auth_flows SET link_lease_expires_at=now() - interval '1 second'
      WHERE flow_hash='password-flow'
    `);
    const resumed = await database.query<{
      refresh_ciphertext: string | null;
      stage: string;
    }>(`
      SELECT stage,refresh_ciphertext FROM claim_password_link(
        'current-session-hash','current-csrf-hash','unused-flow','lease-2',
        now() + interval '30 seconds',now() + interval '15 minutes'
      )
    `);
    expect(resumed.rows).toEqual([{ refresh_ciphertext: null, stage: "provider-updated" }]);

    const completed = await database.query<{
      access_scope: string;
      id: string;
      methods: { method: string }[];
    }>(`
      SELECT id::text,access_scope,methods FROM complete_password_link(
        'password-flow','current-session-hash','lease-2',
        '21900000-0000-0000-0000-000000000004','linked-session-hash','linked-csrf-hash',
        now() + interval '30 days'
      )
    `);
    expect(completed.rows).toEqual([
      {
        access_scope: "full",
        id: "21900000-0000-0000-0000-000000000004",
        methods: [
          expect.objectContaining({ method: "password" }),
          expect.objectContaining({ method: "google" }),
        ],
      },
    ]);
    const sessions = await database.query<{ id: string; revoked: boolean }>(`
      SELECT id::text,revoked_at IS NOT NULL AS revoked FROM web_sessions
      WHERE user_id='${userId}' ORDER BY id
    `);
    const extensions = await database.query<{ revoked: boolean }>(`
      SELECT revoked_at IS NOT NULL AS revoked FROM extension_sessions WHERE user_id='${userId}'
    `);
    expect(sessions.rows).toEqual([
      { id: "21900000-0000-0000-0000-000000000001", revoked: true },
      { id: "21900000-0000-0000-0000-000000000002", revoked: true },
      { id: "21900000-0000-0000-0000-000000000004", revoked: false },
    ]);
    expect(extensions.rows).toEqual([{ revoked: true }]);
  });

  it("distinguishes an already linked password without creating a flow", async () => {
    await database.exec(`
      INSERT INTO account_sign_in_methods(owner_user_id,method) VALUES ('${userId}','password')
    `);
    const linked = await database.query<{
      flow_hash: string | null;
      stage: string;
      user_id: string;
    }>(`
      SELECT flow_hash,user_id::text,stage FROM claim_password_link(
        'current-session-hash','current-csrf-hash','unused-flow','unused-lease',
        now() + interval '30 seconds',now() + interval '15 minutes'
      )
    `);
    const wrongProof = await database.query<{ stage: string; user_id: string }>(`
      SELECT user_id::text,stage FROM claim_password_link(
        'current-session-hash','wrong-csrf','wrong-proof-flow','wrong-proof-lease',
        now() + interval '30 seconds',now() + interval '15 minutes'
      )
    `);
    const flows = await database.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM auth_flows WHERE kind='link-password'
    `);
    expect(linked.rows).toEqual([{ flow_hash: null, stage: "already-linked", user_id: userId }]);
    expect(wrongProof.rows).toEqual([]);
    expect(flows.rows).toEqual([{ count: 0 }]);
  });
});

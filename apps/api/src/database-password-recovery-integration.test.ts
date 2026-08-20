import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";

describe("Cloud V1 password recovery database state machine", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES
        ('${userA}','${userA}','learner@example.test','active','UTC',5),
        ('${userB}','${userB}','google@example.test','active','UTC',5);
      INSERT INTO account_sign_in_methods(owner_user_id,method) VALUES
        ('${userA}','password'),('${userB}','google');
      INSERT INTO web_sessions(
        id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,expires_at
      ) VALUES
        ('31000000-0000-0000-0000-000000000001','${userA}','${userA}',
         'web-a','csrf-a','refresh-a',now()+interval '1 day'),
        ('31000000-0000-0000-0000-000000000002','${userA}','${userA}',
         'web-b','csrf-b','refresh-b',now()+interval '1 day');
      INSERT INTO extension_sessions(
        id,user_id,owner_user_id,install_id_hash,token_hash,device_label,expires_at
      ) VALUES (
        '31000000-0000-0000-0000-000000000003','${userA}','${userA}',
        'install-a','extension-a','MacBook',now()+interval '1 day'
      );
    `);
  });

  afterEach(async () => database.close());

  it("creates only eligible flows, invalidates the previous flow, and denies direct business access", async () => {
    const unknown = await database.query<{ created: boolean }>(`
      SELECT request_password_recovery(
        'unknown@example.test','unknown-flow','protected-unknown',now()+interval '30 minutes',now()
      ) AS created
    `);
    const googleOnly = await database.query<{ created: boolean }>(`
      SELECT request_password_recovery(
        'google@example.test','google-flow','protected-google',now()+interval '30 minutes',now()
      ) AS created
    `);
    const first = await database.query<{ created: boolean }>(`
      SELECT request_password_recovery(
        'learner@example.test','flow-one','protected-one',now()+interval '30 minutes',now()
      ) AS created
    `);
    const second = await database.query<{ created: boolean }>(`
      SELECT request_password_recovery(
        'learner@example.test','flow-two','protected-two',now()+interval '30 minutes',now()
      ) AS created
    `);
    expect([unknown.rows, googleOnly.rows, first.rows, second.rows]).toEqual([
      [{ created: false }],
      [{ created: false }],
      [{ created: true }],
      [{ created: true }],
    ]);
    const stages = await database.query<{ flow_hash: string; stage: string }>(
      "SELECT flow_hash,stage FROM password_recovery_flows ORDER BY created_at,flow_hash",
    );
    expect(stages.rows).toEqual([
      { flow_hash: "flow-one", stage: "failed" },
      { flow_hash: "flow-two", stage: "requested" },
    ]);

    const protection = await database.query<{
      relforcerowsecurity: boolean;
      relrowsecurity: boolean;
    }>(`
      SELECT relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE relname='password_recovery_flows'
    `);
    expect(protection.rows).toEqual([{ relforcerowsecurity: true, relrowsecurity: true }]);
    await expect(
      database.transaction(async (transaction) => {
        await transaction.exec("SET LOCAL ROLE huayi_business");
        await transaction.query("SELECT * FROM password_recovery_flows");
      }),
    ).rejects.toThrow();
  });

  it("marks dispatch before provider work and never reclaims an ambiguous dispatch", async () => {
    await database.exec(`
      SELECT request_password_recovery(
        'learner@example.test','flow-one','protected-one',now()+interval '30 minutes',now()
      )
    `);
    const claimed = await database.query<{
      callback_flow_ciphertext: string;
      email: string;
      flow_hash: string;
    }>(`
      SELECT flow_hash,email,callback_flow_ciphertext FROM claim_password_recovery_dispatch(
        'dispatch-lease',now()+interval '60 seconds',now()
      )
    `);
    expect(claimed.rows).toEqual([
      {
        callback_flow_ciphertext: "protected-one",
        email: "learner@example.test",
        flow_hash: "flow-one",
      },
    ]);
    const marked = await database.query<{ saved: boolean }>(`
      SELECT mark_password_recovery_dispatched(
        'flow-one','dispatch-lease',now()
      ) AS saved
    `);
    expect(marked.rows).toEqual([{ saved: true }]);
    await database.exec(`
      UPDATE password_recovery_flows SET dispatch_lease_expires_at=now()-interval '1 second'
      WHERE flow_hash='flow-one'
    `);
    const reclaimed = await database.query<{ flow_hash: string }>(`
      SELECT flow_hash FROM claim_password_recovery_dispatch(
        'other-lease',now()+interval '60 seconds',now()
      )
    `);
    expect(reclaimed.rows).toEqual([]);
    const stage = await database.query<{ stage: string }>(
      "SELECT stage FROM password_recovery_flows WHERE flow_hash='flow-one'",
    );
    expect(stage.rows).toEqual([{ stage: "failed" }]);
  });

  it("does not dispatch after the owner becomes ineligible", async () => {
    await database.exec(`
      SELECT request_password_recovery(
        'learner@example.test','flow-one','protected-one',now()+interval '30 minutes',now()
      );
      UPDATE user_profiles SET status='disabled' WHERE user_id='${userA}';
    `);
    const claimed = await database.query<{ flow_hash: string }>(`
      SELECT flow_hash FROM claim_password_recovery_dispatch(
        'dispatch-lease',now()+interval '60 seconds',now()
      )
    `);
    expect(claimed.rows).toEqual([]);
    const stage = await database.query<{ stage: string }>(
      "SELECT stage FROM password_recovery_flows WHERE flow_hash='flow-one'",
    );
    expect(stage.rows).toEqual([{ stage: "failed" }]);
  });

  it("fences callback and completion, revokes all sessions, and writes one notification", async () => {
    await database.exec(`
      SELECT request_password_recovery(
        'learner@example.test','flow-one','protected-one',now()+interval '30 minutes',now()
      );
      SELECT * FROM claim_password_recovery_dispatch(
        'dispatch-lease',now()+interval '60 seconds',now()
      );
      SELECT mark_password_recovery_dispatched('flow-one','dispatch-lease',now());
      SELECT save_password_recovery_sent(
        'flow-one','dispatch-lease','protected-pkce',now()
      );
    `);
    const state = await database.query<{ provider_state: string | null }>(`
      SELECT read_password_recovery_state('flow-one',now()) AS provider_state
    `);
    expect(state.rows).toEqual([{ provider_state: "protected-pkce" }]);
    const verified = await database.query<{ saved: boolean }>(`
      SELECT complete_password_recovery_callback(
        'flow-one','${userA}','learner@example.test','protected-session',
        'recovery-session','csrf-one',now()+interval '15 minutes',now()
      ) AS saved
    `);
    expect(verified.rows).toEqual([{ saved: true }]);
    const session = await database.query<{ expires_at: Date }>(`
      SELECT expires_at FROM read_password_recovery_session(
        'recovery-session','csrf-two',now()
      )
    `);
    expect(session.rows).toHaveLength(1);
    const claimed = await database.query<{
      flow_hash: string;
      provider_state_ciphertext: string;
      stage: string;
    }>(`
      SELECT flow_hash,stage,provider_state_ciphertext
      FROM claim_password_recovery_completion(
        'recovery-session','csrf-two','complete-lease',now()+interval '30 seconds',now()
      )
    `);
    expect(claimed.rows).toEqual([
      {
        flow_hash: "flow-one",
        provider_state_ciphertext: "protected-session",
        stage: "verified",
      },
    ]);
    const mismatch = await database.query<{ saved: boolean | null }>(`
      SELECT save_password_recovery_provider_updated(
        'flow-one','complete-lease','${userB}','untrusted-state',now()
      ) AS saved
    `);
    const updated = await database.query<{ saved: boolean }>(`
      SELECT save_password_recovery_provider_updated(
        'flow-one','complete-lease','${userA}','protected-updated',now()
      ) AS saved
    `);
    expect(mismatch.rows).toEqual([{ saved: null }]);
    expect(updated.rows).toEqual([{ saved: true }]);
    const completed = await database.query<{ saved: boolean }>(`
      SELECT complete_password_recovery(
        'flow-one','complete-lease','32000000-0000-0000-0000-000000000001',now()
      ) AS saved
    `);
    expect(completed.rows).toEqual([{ saved: true }]);

    const authority = await database.query<{
      extension_active: number;
      notifications: number;
      stage: string;
      web_active: number;
    }>(`
      SELECT flows.stage,
        (SELECT count(*)::integer FROM web_sessions WHERE revoked_at IS NULL) AS web_active,
        (SELECT count(*)::integer FROM extension_sessions WHERE revoked_at IS NULL)
          AS extension_active,
        (SELECT count(*)::integer FROM security_notification_outbox) AS notifications
      FROM password_recovery_flows flows WHERE flow_hash='flow-one'
    `);
    expect(authority.rows).toEqual([
      { extension_active: 0, notifications: 1, stage: "completed", web_active: 0 },
    ]);
    const replay = await database.query<{ saved: boolean }>(`
      SELECT complete_password_recovery(
        'flow-one','complete-lease','32000000-0000-0000-0000-000000000002',now()
      ) AS saved
    `);
    expect(replay.rows).toEqual([{ saved: false }]);
  });

  it("reclaims only an expired completion lease and cleans at most 100 old terminal flows", async () => {
    await database.exec(`
      SELECT request_password_recovery(
        'learner@example.test','flow-one','protected-one',now()+interval '30 minutes',now()
      );
      UPDATE password_recovery_flows SET stage='provider-updated',dispatch_at=now(),
        provider_state_ciphertext='protected-state',recovery_session_hash='recovery-session',
        csrf_hash='csrf-one',browser_expires_at=now()+interval '15 minutes',
        completion_lease_hash='old-lease',completion_lease_expires_at=now()-interval '1 second'
      WHERE flow_hash='flow-one';
    `);
    const resumed = await database.query<{ flow_hash: string; stage: string }>(`
      SELECT flow_hash,stage FROM claim_password_recovery_completion(
        'recovery-session','csrf-one','new-lease',now()+interval '30 seconds',now()
      )
    `);
    expect(resumed.rows).toEqual([{ flow_hash: "flow-one", stage: "provider-updated" }]);
    await database.exec(`
      UPDATE password_recovery_flows SET stage='failed',consumed_at=now()-interval '25 hours',
        completion_lease_hash=NULL,completion_lease_expires_at=NULL,
        recovery_session_hash=NULL,csrf_hash=NULL WHERE flow_hash='flow-one'
    `);
    const cleaned = await database.query<{ count: number }>(
      "SELECT cleanup_password_recovery_flows(100,now()) AS count",
    );
    expect(cleaned.rows).toEqual([{ count: 1 }]);
    await expect(
      database.query("SELECT cleanup_password_recovery_flows(101,now())"),
    ).rejects.toThrow();
  });

  it("leases one security notification and fences a delayed retry and completion", async () => {
    const notificationId = "32000000-0000-0000-0000-000000000003";
    await database.exec(`
      INSERT INTO security_notification_outbox(
        id,owner_user_id,kind,available_at,created_at
      ) VALUES (
        '${notificationId}','${userA}','password-reset-completed',
        '2026-08-14T10:00:00.000Z','2026-08-14T10:00:00.000Z'
      )
    `);
    const first = await database.query<{
      attempt_count: number;
      email: string;
      notification_id: string;
    }>(`
      SELECT notification_id::text,email,attempt_count FROM claim_security_notification(
        'lease-one','2026-08-14T10:02:00.000Z','2026-08-14T10:00:00.000Z'
      )
    `);
    expect(first.rows).toEqual([
      {
        attempt_count: 1,
        email: "learner@example.test",
        notification_id: notificationId,
      },
    ]);
    const retried = await database.query<{ saved: boolean }>(`
      SELECT retry_security_notification(
        '${notificationId}','lease-one','2026-08-14T10:01:00.000Z',
        '2026-08-14T10:00:30.000Z'
      ) AS saved
    `);
    expect(retried.rows).toEqual([{ saved: true }]);
    const early = await database.query<{ notification_id: string }>(`
      SELECT notification_id::text FROM claim_security_notification(
        'lease-two','2026-08-14T10:02:59.000Z','2026-08-14T10:00:59.000Z'
      )
    `);
    expect(early.rows).toEqual([]);
    const second = await database.query<{ attempt_count: number }>(`
      SELECT attempt_count FROM claim_security_notification(
        'lease-two','2026-08-14T10:03:00.000Z','2026-08-14T10:01:00.000Z'
      )
    `);
    expect(second.rows).toEqual([{ attempt_count: 2 }]);
    const stale = await database.query<{ saved: boolean }>(`
      SELECT complete_security_notification(
        '${notificationId}','lease-one','2026-08-14T10:01:30.000Z'
      ) AS saved
    `);
    const completed = await database.query<{ saved: boolean }>(`
      SELECT complete_security_notification(
        '${notificationId}','lease-two','2026-08-14T10:01:30.000Z'
      ) AS saved
    `);
    expect(stale.rows).toEqual([{ saved: false }]);
    expect(completed.rows).toEqual([{ saved: true }]);
    const state = await database.query<{
      attempt_count: number;
      lease_hash: string | null;
      sent_at: Date;
      status: string;
    }>(`
      SELECT status,attempt_count,lease_hash,sent_at
      FROM security_notification_outbox WHERE id='${notificationId}'
    `);
    expect(state.rows).toEqual([
      {
        attempt_count: 2,
        lease_hash: null,
        sent_at: new Date("2026-08-14T10:01:30.000Z"),
        status: "sent",
      },
    ]);
  });
});

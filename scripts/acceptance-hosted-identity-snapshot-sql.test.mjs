import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  parseHostedIdentitySnapshotOutput,
  renderHostedIdentitySnapshotSql,
} from "./acceptance-hosted-identity-snapshot.mjs";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");
const baselineUrl = new URL("../apps/api/migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const interruptionRecoveryUrl = new URL(
  "../apps/api/migrations/0013-password-signup-interruption-recovery.sql",
  import.meta.url,
);
const otpResendUrl = new URL(
  "../apps/api/migrations/0014-password-signup-otp-resend.sql",
  import.meta.url,
);

const invitationId = "71000000-0000-4000-8000-000000000001";
const userId = "72000000-0000-4000-8000-000000000001";
const operatorId = "73000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const database = new PGlite();
  await database.waitReady;
  await database.exec(await readFile(baselineUrl, "utf8"));
  await database.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      email_confirmed_at timestamptz
    );
    CREATE TABLE auth.identities (
      id text PRIMARY KEY,
      user_id uuid NOT NULL,
      provider text NOT NULL
    );
  `);
  await database.exec(await readFile(interruptionRecoveryUrl, "utf8"));
  await database.exec(await readFile(otpResendUrl, "utf8"));
  return database;
}

async function readSnapshot(database) {
  const result = await database.exec(renderHostedIdentitySnapshotSql());
  const rows = result[1]?.rows;
  assert.ok(Array.isArray(rows));
  return parseHostedIdentitySnapshotOutput(`${rows.map((row) => row.line).join("\n")}\n`);
}

async function seedInvitation(
  database,
  { authState = "unconfirmed", claimState = "bound-active", finalized = false } = {},
) {
  const invitationConsumed = finalized ? "now()" : "NULL";
  const claimExpiry =
    claimState === "bound-expired" ? "now()-interval '1 second'" : "now()+interval '15 minutes'";
  const flowExpiry =
    claimState === "bound-expired" ? "now()-interval '1 second'" : "now()+interval '15 minutes'";
  const flowCreated = claimState === "bound-expired" ? "now()-interval '1 hour'" : "now()";
  const flowConsumed = finalized ? "now()" : "NULL";
  const finalizedUser = finalized ? `'${userId}'` : "NULL";
  const emailConfirmed = authState === "confirmed" ? "now()" : "NULL";
  await database.exec(`
    INSERT INTO invitations(
      id,token_hash,expires_at,consumed_at,created_by,created_at
    ) VALUES(
      '${invitationId}',repeat('i',43),now()+interval '1 day',${invitationConsumed},
      '${operatorId}',now()
    );
    INSERT INTO invitation_claims(
      ticket_hash,invitation_id,expires_at,finalized_user_id,bound_user_id,bound_email
    ) VALUES(
      repeat('c',43),'${invitationId}',${claimExpiry},${finalizedUser},
      '${userId}','learner@example.com'
    );
    INSERT INTO auth_flows(
      flow_hash,kind,ticket_hash,expires_at,consumed_at,created_at
    ) VALUES(
      repeat('f',43),'invite-registration',repeat('c',43),${flowExpiry},${flowConsumed},
      ${flowCreated}
    );
    INSERT INTO auth.users(id,email,email_confirmed_at)
    VALUES('${userId}','learner@example.com',${emailConfirmed});
    INSERT INTO auth.identities(id,user_id,provider)
    VALUES('email-identity','${userId}','email');
  `);
}

test("identity snapshot SQL is one repeatable-read read-only transaction with fixed output", () => {
  const sql = renderHostedIdentitySnapshotSql();
  assert.match(sql, /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n/u);
  assert.match(sql, /created_by_kind = 'operator'/u);
  assert.match(sql, /ORDER BY invitations\.created_at DESC,invitations\.id DESC/u);
  assert.match(sql, /auth\.users/u);
  assert.match(sql, /auth\.identities/u);
  assert.match(sql, /public\.learning_items/u);
  assert.match(sql, /public\.analysis_records/u);
  assert.match(sql, /public\.practice_sessions/u);
  assert.match(sql, /snapshot_rows\(ordinal,field_name,field_value\)/u);
  assert.match(sql, /SELECT field_name \|\| '\|' \|\| field_value AS line/u);
  assert.match(sql, /ROLLBACK;\n$/u);
  assert.doesNotMatch(sql, /\\gset|\\if|\\endif/u);
});

test("identity snapshot classifies an empty hosted identity state", async () => {
  const database = await createDatabase();
  try {
    const snapshot = await readSnapshot(database);
    assert.deepEqual(snapshot, {
      ordinary_invitations_total: "0",
      ordinary_available_count: "0",
      ordinary_expired_count: "0",
      ordinary_consumed_count: "0",
      ordinary_revoked_count: "0",
      ordinary_invalid_count: "0",
      latest_invitation_state: "none",
      latest_claim_count: "0",
      latest_claim_state: "none",
      latest_registration_flow_count: "0",
      latest_registration_flow_state: "none",
      subject_auth_user_state: "none",
      subject_email_binding_exact: "f",
      subject_auth_identity_count: "0",
      subject_email_identity_exact: "f",
      subject_profile_state: "none",
      subject_password_method_count: "0",
      subject_google_method_count: "0",
      subject_current_quota_count: "0",
      subject_active_web_session_count: "0",
      subject_active_extension_session_count: "0",
      subject_learning_item_count: "0",
      subject_analysis_record_count: "0",
      subject_practice_session_count: "0",
      subject_registration_blocker_count: "0",
      subject_learning_data_present: "f",
      otp_resend_eligible: "f",
      interrupted_resume_eligible: "f",
      account_finalized_exact: "f",
      safe_route_state: "no-invitation",
    });
  } finally {
    await database.close();
  }
});

test("identity snapshot identifies one eligible six-digit OTP resend without exposing identity", async () => {
  const database = await createDatabase();
  try {
    await seedInvitation(database);
    const snapshot = await readSnapshot(database);
    assert.equal(snapshot?.latest_invitation_state, "available");
    assert.equal(snapshot?.latest_claim_state, "bound-active");
    assert.equal(snapshot?.latest_registration_flow_state, "active");
    assert.equal(snapshot?.subject_auth_user_state, "unconfirmed");
    assert.equal(snapshot?.subject_email_binding_exact, "t");
    assert.equal(snapshot?.otp_resend_eligible, "t");
    assert.equal(snapshot?.interrupted_resume_eligible, "f");
    assert.equal(snapshot?.account_finalized_exact, "f");
    assert.equal(snapshot?.safe_route_state, "otp-resend");
    assert.equal(JSON.stringify(snapshot).includes("learner@example.com"), false);
    assert.equal(JSON.stringify(snapshot).includes(userId), false);
  } finally {
    await database.close();
  }
});

test("identity snapshot identifies one eligible interrupted confirmed registration", async () => {
  const database = await createDatabase();
  try {
    await seedInvitation(database, { authState: "confirmed", claimState: "bound-expired" });
    const snapshot = await readSnapshot(database);
    assert.equal(snapshot?.latest_claim_state, "bound-expired");
    assert.equal(snapshot?.latest_registration_flow_state, "expired");
    assert.equal(snapshot?.subject_auth_user_state, "confirmed");
    assert.equal(snapshot?.otp_resend_eligible, "f");
    assert.equal(snapshot?.interrupted_resume_eligible, "t");
    assert.equal(snapshot?.safe_route_state, "resume-registration");
  } finally {
    await database.close();
  }
});

test("identity snapshot distinguishes an established account from an interrupted registration", async () => {
  const database = await createDatabase();
  try {
    await seedInvitation(database, { authState: "confirmed", finalized: true });
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userId}','${userId}','learner@example.com','active','UTC',5);
      INSERT INTO account_sign_in_methods(owner_user_id,method)
      VALUES('${userId}','password');
      INSERT INTO quota_grants(
        id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source
      ) VALUES(
        '74000000-0000-4000-8000-000000000001','${userId}','${userId}',
        now()-interval '1 day',now()+interval '29 days',1000000,'default'
      );
    `);
    const snapshot = await readSnapshot(database);
    assert.equal(snapshot?.latest_invitation_state, "consumed");
    assert.equal(snapshot?.latest_claim_state, "finalized");
    assert.equal(snapshot?.latest_registration_flow_state, "consumed");
    assert.equal(snapshot?.subject_profile_state, "active");
    assert.equal(snapshot?.subject_registration_blocker_count, "3");
    assert.equal(snapshot?.account_finalized_exact, "t");
    assert.equal(snapshot?.otp_resend_eligible, "f");
    assert.equal(snapshot?.interrupted_resume_eligible, "f");
    assert.equal(snapshot?.safe_route_state, "account-established");
  } finally {
    await database.close();
  }
});

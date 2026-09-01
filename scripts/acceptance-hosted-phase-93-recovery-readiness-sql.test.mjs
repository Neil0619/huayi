import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  parseHostedPhase93RecoveryReadinessOutput,
  renderHostedPhase93RecoveryReadinessSql,
} from "./acceptance-hosted-phase-93-recovery-readiness.mjs";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");
const baselineUrl = new URL("../apps/api/migrations/0001-cloud-v1-foundation.sql", import.meta.url);
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
  await database.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
  `);
  await database.exec(await readFile(baselineUrl, "utf8"));
  await database.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE TABLE auth.identities(id text PRIMARY KEY,user_id uuid NOT NULL,provider text NOT NULL);
  `);
  await database.exec(await readFile(otpResendUrl, "utf8"));
  return database;
}

async function seedEligible(database) {
  await database.exec(`
    INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
    VALUES('${operatorId}','${operatorId}','operator@example.com','active','UTC',5);
    INSERT INTO admin_roles(user_id,role) VALUES('${operatorId}','operator');
    INSERT INTO invitations(id,token_hash,expires_at,created_by,created_by_kind,created_at)
    VALUES('${invitationId}',repeat('i',43),now()-interval '1 hour','${operatorId}',
      'operator',now()-interval '2 hours');
    INSERT INTO invitation_claims(
      ticket_hash,invitation_id,expires_at,bound_user_id,bound_email,created_at
    ) VALUES(repeat('c',43),'${invitationId}',now()-interval '1 hour','${userId}',
      'learner@example.com',now()-interval '2 hours');
    INSERT INTO auth_flows(flow_hash,kind,ticket_hash,expires_at,created_at)
    VALUES(repeat('f',43),'invite-registration',repeat('c',43),now()-interval '1 hour',
      now()-interval '2 hours');
    INSERT INTO auth.users(id,email,email_confirmed_at)
    VALUES('${userId}','learner@example.com',NULL);
    INSERT INTO auth.identities(id,user_id,provider)
    VALUES('email-identity','${userId}','email');
  `);
}

async function readReadiness(database) {
  const result = await database.exec(renderHostedPhase93RecoveryReadinessSql());
  const rows = result[1]?.rows;
  assert.ok(Array.isArray(rows));
  return parseHostedPhase93RecoveryReadinessOutput(`${rows.map((row) => row.line).join("\n")}\n`);
}

test("SQL covers every stored-state precondition from 0023 in one sanitized snapshot", () => {
  const sql = renderHostedPhase93RecoveryReadinessSql();
  assert.match(sql, /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n/u);
  for (const fragment of [
    "created_by_kind = 'operator'",
    "public.require_admin_operator(invitation.created_by) = 'operator'",
    "token_hash ~ '^[A-Za-z0-9_-]{43}$'",
    "public.invitation_claims",
    "public.auth_flows",
    "auth.users",
    "auth.identities",
    "invitation.token-recovered",
    "public.user_profiles",
    "public.account_sign_in_methods",
    "public.password_recovery_flows",
    "public.security_notification_outbox",
    "public.web_sessions",
    "public.account_data_export_jobs",
    "public.account_deletion_jobs",
    "public.extension_sessions",
    "public.extension_pairings",
    "public.admin_roles",
    "public.audit_events",
    "public.study_captures",
    "public.analysis_records",
    "public.learning_items",
    "public.word_entries",
    "public.practice_sessions",
    "public.quota_grants",
    "public.quota_reservations",
    "public.usage_ledger",
    "public.model_rate_limit_events",
  ]) {
    assert.match(sql, new RegExp(fragment.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(sql, /rows\.user_id = claims\.bound_user_id OR rows\.email = claims\.bound_email/u);
  assert.match(sql, /eligible_verdict/u);
  assert.match(sql, /ROLLBACK;\n$/u);
  assert.doesNotMatch(sql, /\\gset|\\if|\\endif/u);
});

test("one exact expired invitation is eligible without exposing identity", async () => {
  const database = await createDatabase();
  try {
    await seedEligible(database);
    const readiness = await readReadiness(database);
    assert.equal(readiness?.ordinary_invitation_unique, "t");
    assert.equal(readiness?.mutation_preconditions_exact, "t");
    assert.equal(readiness?.eligible_verdict, "eligible");
    assert.equal(JSON.stringify(readiness).includes(userId), false);
    assert.equal(JSON.stringify(readiness).includes("learner@example.com"), false);
    assert.equal(JSON.stringify(readiness).includes("i".repeat(43)), false);
  } finally {
    await database.close();
  }
});

test("a profile owned by another user with the bound email is not eligible", async () => {
  const database = await createDatabase();
  try {
    await seedEligible(database);
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('72000000-0000-4000-8000-000000000002',
        '72000000-0000-4000-8000-000000000002','learner@example.com','active','UTC',5)
    `);
    const readiness = await readReadiness(database);
    assert.equal(readiness?.user_profiles_absent, "f");
    assert.equal(readiness?.mutation_preconditions_exact, "f");
    assert.equal(readiness?.eligible_verdict, "not-eligible");
  } finally {
    await database.close();
  }
});

test("every mutation drift produces not-eligible without writes", async () => {
  const drifts = [
    "UPDATE invitations SET expires_at=now()+interval '1 hour'",
    "UPDATE invitation_claims SET expires_at=now()+interval '1 hour'",
    "UPDATE auth_flows SET expires_at=now()+interval '1 hour'",
    "UPDATE auth.users SET email_confirmed_at=now()",
    `INSERT INTO auth.identities(id,user_id,provider) VALUES('extra','${userId}','google')`,
    `INSERT INTO audit_events(id,actor_user_id,action,subject_id)
      VALUES('74000000-0000-4000-8000-000000000001','${operatorId}',
        'invitation.token-recovered','${invitationId}')`,
    `INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userId}','${userId}','learner@example.com','active','UTC',5)`,
  ];
  for (const drift of drifts) {
    const database = await createDatabase();
    try {
      await seedEligible(database);
      await database.exec(drift);
      const before = await database.query("SELECT token_hash FROM invitations");
      const readiness = await readReadiness(database);
      const after = await database.query("SELECT token_hash FROM invitations");
      assert.equal(readiness?.mutation_preconditions_exact, "f");
      assert.equal(readiness?.eligible_verdict, "not-eligible");
      assert.deepEqual(after.rows, before.rows);
    } finally {
      await database.close();
    }
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  parseHostedPostReloginSessionDiagnosticOutput,
  renderHostedPostReloginSessionDiagnosticSql,
} from "./acceptance-hosted-post-relogin-session-diagnostic.mjs";

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
const learnerId = "72000000-0000-4000-8000-000000000001";
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
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
    INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20260831010000');
  `);
  await database.exec(await readFile(interruptionRecoveryUrl, "utf8"));
  await database.exec(await readFile(otpResendUrl, "utf8"));
  return database;
}

async function seedFinalizedAccount(database) {
  await database.exec(`
    INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
    VALUES
      ('${operatorId}','${operatorId}','operator@example.com','active','UTC',5),
      ('${learnerId}','${learnerId}','learner@example.com','active','UTC',5);
    INSERT INTO admin_roles(user_id,role) VALUES('${operatorId}','operator');
    INSERT INTO invitations(
      id,token_hash,expires_at,consumed_at,created_by,created_by_kind,created_at
    ) VALUES(
      '${invitationId}',repeat('i',43),now()-interval '1 day',now()-interval '1 hour',
      '${operatorId}','operator',now()-interval '2 days'
    );
    INSERT INTO invitation_claims(
      ticket_hash,invitation_id,expires_at,finalized_user_id,bound_user_id,bound_email,created_at
    ) VALUES(
      repeat('c',43),'${invitationId}',now()-interval '1 day','${learnerId}',
      '${learnerId}','learner@example.com',now()-interval '2 days'
    );
    INSERT INTO auth_flows(
      flow_hash,kind,ticket_hash,expires_at,consumed_at,created_at
    ) VALUES(
      repeat('f',43),'invite-registration',repeat('c',43),now()-interval '1 day',
      now()-interval '1 hour',now()-interval '2 days'
    );
    INSERT INTO auth.users(id,email,email_confirmed_at)
    VALUES('${learnerId}','learner@example.com',now()-interval '1 hour');
    INSERT INTO auth.identities(id,user_id,provider)
    VALUES('email-identity','${learnerId}','email');
    INSERT INTO account_sign_in_methods(owner_user_id,method)
    VALUES('${learnerId}','password');
    INSERT INTO quota_grants(
      id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source
    ) VALUES(
      '74000000-0000-4000-8000-000000000001','${learnerId}','${learnerId}',
      now()-interval '1 day',now()+interval '29 days',1000000,'default'
    );
  `);
}

async function readDiagnostic(database) {
  const result = await database.exec(renderHostedPostReloginSessionDiagnosticSql());
  const rows = result[1]?.rows;
  assert.ok(Array.isArray(rows));
  return parseHostedPostReloginSessionDiagnosticOutput(
    `${rows.map((row) => row.line).join("\n")}\n`,
  );
}

async function insertSession(
  database,
  { id, ownerUserId, sessionHash, state = "active-full", createdOffset = "1 minute" },
) {
  const revokedAt = state === "revoked" ? "now()-interval '1 second'" : "NULL";
  const expiresAt = state === "expired" ? "now()-interval '1 second'" : "now()+interval '30 days'";
  const accessScope = state === "active-nonfull" ? "data-rights" : "full";
  await database.exec(`
    INSERT INTO web_sessions(
      id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,access_scope,
      expires_at,revoked_at,created_at
    ) VALUES(
      '${id}','${ownerUserId}','${ownerUserId}','${sessionHash}',repeat('c',43),'ciphertext',
      '${accessScope}',${expiresAt},${revokedAt},now()-interval '${createdOffset}'
    )
  `);
}

test("SQL is one fixed read-only transaction and exposes no identity material", () => {
  const sql = renderHostedPostReloginSessionDiagnosticSql();
  assert.match(sql, /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n/u);
  for (const fragment of [
    "version::text = '20260831010000'",
    "created_by_kind = 'operator'",
    "public.invitation_claims",
    "public.auth_flows",
    "auth.users",
    "auth.identities",
    "public.web_sessions",
    "public.admin_roles",
    "subject_latest_session_state",
    "diagnostic_verdict",
  ]) {
    assert.match(sql, new RegExp(fragment.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(sql, /SELECT field_name \|\| '\|' \|\| field_value AS line/u);
  assert.match(sql, /ROLLBACK;\n$/u);
  assert.doesNotMatch(sql, /\\gset|\\if|\\endif/u);
});

test("current symptom classifies an active other account without exposing identity", async () => {
  const database = await createDatabase();
  try {
    await seedFinalizedAccount(database);
    await insertSession(database, {
      id: "75000000-0000-4000-8000-000000000001",
      ownerUserId: learnerId,
      sessionHash: "learner-revoked-session",
      state: "revoked",
      createdOffset: "2 minutes",
    });
    await insertSession(database, {
      id: "75000000-0000-4000-8000-000000000002",
      ownerUserId: operatorId,
      sessionHash: "operator-active-session",
    });

    const diagnostic = await readDiagnostic(database);
    assert.deepEqual(diagnostic, {
      migration_0023_applied: "t",
      ordinary_invitation_unique: "t",
      subject_account_exact: "t",
      session_owner_contract_exact: "t",
      all_web_session_count: "2",
      all_active_web_session_count: "1",
      subject_web_session_count: "1",
      subject_active_web_session_count: "0",
      subject_active_full_session_count: "0",
      subject_active_nonfull_session_count: "0",
      subject_revoked_web_session_count: "1",
      subject_expired_web_session_count: "0",
      other_active_web_session_count: "1",
      other_active_operator_session_count: "1",
      other_active_non_operator_session_count: "0",
      subject_session_partition_exact: "t",
      active_session_partition_exact: "t",
      subject_latest_session_state: "revoked",
      diagnostic_verdict: "other-active-only",
    });
    const rendered = JSON.stringify(diagnostic);
    assert.equal(rendered.includes(learnerId), false);
    assert.equal(rendered.includes(operatorId), false);
    assert.equal(rendered.includes("example.com"), false);
    assert.equal(rendered.includes("session"), true);
  } finally {
    await database.close();
  }
});

test("no active rows distinguishes runtime database divergence from another-account login", async () => {
  const database = await createDatabase();
  try {
    await seedFinalizedAccount(database);
    await insertSession(database, {
      id: "75000000-0000-4000-8000-000000000001",
      ownerUserId: learnerId,
      sessionHash: "learner-revoked-session",
      state: "revoked",
    });
    const diagnostic = await readDiagnostic(database);
    assert.equal(diagnostic?.all_active_web_session_count, "0");
    assert.equal(diagnostic?.subject_latest_session_state, "revoked");
    assert.equal(diagnostic?.diagnostic_verdict, "no-active-session");
  } finally {
    await database.close();
  }
});

test("one fresh learner session closes the post-relogin database side", async () => {
  const database = await createDatabase();
  try {
    await seedFinalizedAccount(database);
    await insertSession(database, {
      id: "75000000-0000-4000-8000-000000000001",
      ownerUserId: learnerId,
      sessionHash: "learner-revoked-session",
      state: "revoked",
      createdOffset: "2 minutes",
    });
    await insertSession(database, {
      id: "75000000-0000-4000-8000-000000000002",
      ownerUserId: learnerId,
      sessionHash: "learner-active-session",
    });
    const diagnostic = await readDiagnostic(database);
    assert.equal(diagnostic?.subject_web_session_count, "2");
    assert.equal(diagnostic?.subject_active_web_session_count, "1");
    assert.equal(diagnostic?.subject_active_full_session_count, "1");
    assert.equal(diagnostic?.subject_latest_session_state, "active-full");
    assert.equal(diagnostic?.diagnostic_verdict, "subject-active");
  } finally {
    await database.close();
  }
});

test("multiple or non-full learner sessions remain explicit instead of becoming success", async () => {
  for (const testCase of [
    { states: ["active-full", "active-full"], verdict: "subject-multiple-active" },
    { states: ["active-nonfull"], verdict: "subject-nonfull-active" },
  ]) {
    const database = await createDatabase();
    try {
      await seedFinalizedAccount(database);
      for (const [index, state] of testCase.states.entries()) {
        await insertSession(database, {
          id: `75000000-0000-4000-8000-00000000000${index + 1}`,
          ownerUserId: learnerId,
          sessionHash: `learner-session-${index}`,
          state,
          createdOffset: `${index + 1} minute`,
        });
      }
      const diagnostic = await readDiagnostic(database);
      assert.equal(diagnostic?.diagnostic_verdict, testCase.verdict);
    } finally {
      await database.close();
    }
  }
});

test("an ambiguous invitation target fails closed", async () => {
  const database = await createDatabase();
  try {
    await seedFinalizedAccount(database);
    await database.exec(`
      INSERT INTO invitations(
        id,token_hash,expires_at,created_by,created_by_kind,created_at
      ) VALUES(
        '71000000-0000-4000-8000-000000000002',repeat('j',43),now()+interval '1 day',
        '${operatorId}','operator',now()
      )
    `);
    const diagnostic = await readDiagnostic(database);
    assert.equal(diagnostic?.ordinary_invitation_unique, "f");
    assert.equal(diagnostic?.subject_account_exact, "f");
    assert.equal(diagnostic?.diagnostic_verdict, "target-inconsistent");
  } finally {
    await database.close();
  }
});

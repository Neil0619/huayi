import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const otpResendUrl = new URL("../migrations/0014-password-signup-otp-resend.sql", import.meta.url);
const forwardUrl = new URL("../migrations/0023-invitation-token-recovery.sql", import.meta.url);
const canonicalUrl = new URL(
  "../../../supabase/migrations/20260831010000_invitation_token_recovery.sql",
  import.meta.url,
);
const operatorId = "70000000-0000-4000-8000-000000000001";
const invitationId = "71000000-0000-4000-8000-000000000001";
const userId = "72000000-0000-4000-8000-000000000001";

describe("invitation token recovery migration", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
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
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${operatorId}','${operatorId}','operator@example.com','active','UTC',5);
      INSERT INTO admin_roles(user_id,role) VALUES('${operatorId}','operator');
      INSERT INTO invitations(id,token_hash,expires_at,created_by,created_by_kind,created_at)
      VALUES('${invitationId}',repeat('o',43),'2026-08-30T12:00:00Z','${operatorId}',
        'operator','2026-08-29T12:00:00Z');
      INSERT INTO invitation_claims(
        ticket_hash,invitation_id,expires_at,bound_user_id,bound_email,created_at
      ) VALUES(repeat('c',43),'${invitationId}','2026-08-30T12:00:00Z','${userId}',
        'learner@example.com','2026-08-29T12:00:00Z');
      INSERT INTO auth_flows(flow_hash,ticket_hash,expires_at,created_at)
      VALUES(repeat('f',43),repeat('c',43),'2026-08-30T12:00:00Z','2026-08-29T12:00:00Z');
      INSERT INTO auth.users(id,email,email_confirmed_at)
      VALUES('${userId}','learner@example.com',NULL);
      INSERT INTO auth.identities(id,user_id,provider)
      VALUES('email-identity','${userId}','email');
    `);
  });

  afterEach(async () => database.close());

  it("keeps the API mirror and canonical forward migration byte-identical", async () => {
    const forward = await readFile(forwardUrl, "utf8");
    expect(forward.startsWith("BEGIN;\n")).toBe(true);
    await expect(readFile(canonicalUrl, "utf8")).resolves.toBe(forward);
  });

  it("rotates only the selected token hash, safely replays, and rejects a second rotation", async () => {
    await database.exec(await readFile(forwardUrl, "utf8"));
    const parameters = [
      operatorId,
      invitationId,
      "recover-1",
      "a".repeat(64),
      "n".repeat(43),
      new Date("2026-08-31T12:00:00.000Z"),
      new Date("2026-09-07T12:00:00.000Z"),
      "90000000-0000-4000-8000-000000000001",
    ];
    await expect(
      database.query(
        "SELECT admin_recover_expired_invitation_token($1,$2,$3,$4,$5,$6,$7,$8) AS response",
        parameters,
      ),
    ).resolves.toMatchObject({ rows: [{ response: { id: invitationId, recovered: true } }] });
    await expect(
      database.query(`SELECT
        (SELECT token_hash=repeat('n',43) FROM invitations) AS new_hash,
        (SELECT count(*)::integer FROM invitations) AS invitations,
        (SELECT count(*)::integer FROM invitation_claims) AS claims,
        (SELECT count(*)::integer FROM auth_flows) AS flows,
        (SELECT count(*)::integer FROM auth.users) AS users,
        (SELECT count(*)::integer FROM auth.identities) AS identities`),
    ).resolves.toMatchObject({
      rows: [{ claims: 1, flows: 1, identities: 1, invitations: 1, new_hash: true, users: 1 }],
    });
    const evidence = await database.query<{
      action: string;
      response: unknown;
      safe_details: unknown;
      subject_id: string;
    }>(`SELECT events.action,events.subject_id,events.safe_details,records.response
       FROM audit_events AS events
       JOIN idempotency_records AS records
         ON records.operation='admin.invitation-token-recover'
       WHERE events.action='invitation.token-recovered'`);
    expect(evidence.rows).toEqual([
      {
        action: "invitation.token-recovered",
        response: { id: invitationId, recovered: true },
        safe_details: {},
        subject_id: invitationId,
      },
    ]);
    expect(JSON.stringify(evidence.rows)).not.toContain("o".repeat(43));
    expect(JSON.stringify(evidence.rows)).not.toContain("n".repeat(43));
    await expect(
      database.query(
        "SELECT admin_recover_expired_invitation_token($1,$2,$3,$4,$5,$6,$7,$8)",
        parameters,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          admin_recover_expired_invitation_token: {
            id: invitationId,
            recovered: true,
          },
        },
      ],
    });
    await expect(
      database.query("SELECT admin_recover_expired_invitation_token($1,$2,$3,$4,$5,$6,$7,$8)", [
        operatorId,
        invitationId,
        "recover-2",
        "b".repeat(64),
        "z".repeat(43),
        new Date("2026-08-31T12:00:00.000Z"),
        new Date("2026-09-07T12:00:00.000Z"),
        "90000000-0000-4000-8000-000000000002",
      ]),
    ).rejects.toThrow(/recovery state changed/u);
  });

  it("fails closed without any write when the expired registration shape drifts", async () => {
    await database.exec(await readFile(forwardUrl, "utf8"));
    const cases = [
      "UPDATE invitations SET expires_at='2026-09-01T12:00:00Z'",
      "UPDATE invitation_claims SET expires_at='2026-09-01T12:00:00Z'",
      "UPDATE auth_flows SET expires_at='2026-09-01T12:00:00Z'",
      "UPDATE auth.users SET email_confirmed_at=now()",
      `INSERT INTO auth.identities(id,user_id,provider) VALUES('extra','${userId}','google')`,
      `INSERT INTO audit_events(id,actor_user_id,action,subject_id)
       VALUES('91000000-0000-4000-8000-000000000001','${operatorId}','unexpected','${userId}')`,
    ];
    for (const drift of cases) {
      await database.exec(`BEGIN; ${drift}; SAVEPOINT recovery_attempt;`);
      await expect(
        database.query("SELECT admin_recover_expired_invitation_token($1,$2,$3,$4,$5,$6,$7,$8)", [
          operatorId,
          invitationId,
          "recover-1",
          "a".repeat(64),
          "n".repeat(43),
          new Date("2026-08-31T12:00:00.000Z"),
          new Date("2026-09-07T12:00:00.000Z"),
          "90000000-0000-4000-8000-000000000001",
        ]),
      ).rejects.toThrow(/recovery state changed/u);
      await database.exec("ROLLBACK TO SAVEPOINT recovery_attempt");
      await expect(
        database.query("SELECT token_hash FROM invitations WHERE id=$1", [invitationId]),
      ).resolves.toMatchObject({ rows: [{ token_hash: "o".repeat(43) }] });
      await database.exec("ROLLBACK");
    }
  });

  it("keeps the function private and pins its search path and owner", async () => {
    await database.exec(await readFile(forwardUrl, "utf8"));
    await expect(
      database.query(`SELECT
        p.prosecdef AS security_definer,
        p.proconfig @> ARRAY['search_path=pg_catalog'] AS search_path_exact,
        pg_get_userbyid(p.proowner) AS owner,
        has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
        has_function_privilege('huayi_context_setter',p.oid,'EXECUTE') AS setter_execute
      FROM pg_proc p WHERE p.proname='admin_recover_expired_invitation_token'`),
    ).resolves.toMatchObject({
      rows: [
        {
          anon_execute: false,
          owner: "postgres",
          search_path_exact: true,
          security_definer: true,
          setter_execute: true,
        },
      ],
    });
  });

  it("rejects null security inputs before writing recovery evidence", async () => {
    await database.exec(await readFile(forwardUrl, "utf8"));
    await expect(
      database.query(
        `SELECT admin_recover_expired_invitation_token(
          $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::timestamptz,$7::timestamptz,$8::uuid
        )`,
        [
          operatorId,
          invitationId,
          "recover-1",
          "a".repeat(64),
          null,
          new Date("2026-08-31T12:00:00.000Z"),
          new Date("2026-09-07T12:00:00.000Z"),
          "90000000-0000-4000-8000-000000000001",
        ],
      ),
    ).rejects.toThrow(/administrator required/u);
    await expect(
      database.query(`SELECT
        (SELECT token_hash=repeat('o',43) FROM invitations) AS old_hash,
        (SELECT count(*)::integer FROM audit_events) AS audits,
        (SELECT count(*)::integer FROM idempotency_records) AS idempotency`),
    ).resolves.toMatchObject({ rows: [{ audits: 0, idempotency: 0, old_hash: true }] });
  });
});

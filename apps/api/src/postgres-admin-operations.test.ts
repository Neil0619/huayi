import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdminOperationsModule } from "./admin-operations-module.js";
import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAdminOperations } from "./postgres-admin-operations.js";
import { hashSecret } from "./security.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const otpResendUrl = new URL("../migrations/0014-password-signup-otp-resend.sql", import.meta.url);
const tokenRecoveryUrl = new URL(
  "../migrations/0023-invitation-token-recovery.sql",
  import.meta.url,
);
const operator = "00000000-0000-0000-0000-000000000001";
const account = "00000000-0000-0000-0000-000000000002";
const outsider = "00000000-0000-0000-0000-000000000003";
const now = new Date("2026-08-13T06:00:00.000Z");

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres admin operations", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  let sequence: number;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
    `);
    await database.exec(await readFile(migrationUrl, "utf8"));
    await database.exec(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
      CREATE TABLE auth.identities(id text PRIMARY KEY,user_id uuid NOT NULL,provider text NOT NULL);
    `);
    await database.exec(await readFile(otpResendUrl, "utf8"));
    await database.exec(await readFile(tokenRecoveryUrl, "utf8"));
    adapter = {
      async transaction(ownerUserId, operation) {
        return database.transaction(async (transaction) => {
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          await transaction.query("SELECT huayi_private.set_owner_context($1)", [ownerUserId]);
          return operation({ tenant: query(transaction), trusted: query(transaction) });
        });
      },
      async trusted(operation) {
        return operation(query(database));
      },
    };
    sequence = 100;
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal,created_at)
      VALUES
        ('${operator}','${operator}','operator@example.test','active','UTC',5,'2026-08-13T03:00:00Z'),
        ('${account}','${account}','learner@example.test','active','UTC',5,'2026-08-13T02:00:00Z'),
        ('${outsider}','${outsider}','outsider@example.test','active','UTC',5,'2026-08-13T01:00:00Z');
      INSERT INTO admin_roles(user_id,role) VALUES('${operator}','operator');
      INSERT INTO web_sessions(
        id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,expires_at
      ) VALUES('10000000-0000-0000-0000-000000000001','${account}','${account}',
        'web-hash','csrf-hash','cipher',CURRENT_TIMESTAMP + INTERVAL '1 day');
      INSERT INTO extension_sessions(
        id,user_id,owner_user_id,install_id_hash,token_hash,device_label,expires_at
      ) VALUES('20000000-0000-0000-0000-000000000001','${account}','${account}',
        'install-hash','token-hash','Mac',CURRENT_TIMESTAMP + INTERVAL '1 day');
      INSERT INTO extension_pairings(
        id,user_id,owner_user_id,state_hash,pkce_challenge,install_id_hash,device_label,status,expires_at
      ) VALUES('30000000-0000-0000-0000-000000000001','${account}','${account}',
        'state-hash','challenge','install-hash','Mac','approved',
        CURRENT_TIMESTAMP + INTERVAL '1 day');
    `);
  });

  afterEach(async () => database.close());

  function setup(actorUserId = operator, reauthenticatedAt = now) {
    const repository = createPostgresAdminOperations({
      database: adapter,
      id: () => `90000000-0000-0000-0000-${String(sequence++).padStart(12, "0")}`,
      now: () => now,
      pepper: "test-pepper",
    });
    return {
      authorization: { actorUserId, reauthenticatedAt },
      module: createAdminOperationsModule({
        cursorKey: new Uint8Array(32).fill(1),
        ids: () => `80000000-0000-0000-0000-${String(sequence++).padStart(12, "0")}`,
        invitationRecoveryTokenKey: new Uint8Array(32).fill(3),
        invitationTokenKey: new Uint8Array(32).fill(2),
        repository,
      }),
    };
  }

  it("projects only operator-safe metadata and enforces operator plus recent authentication", async () => {
    const { authorization, module } = setup();
    await expect(module.access(authorization)).resolves.toEqual({ role: "operator" });
    await expect(
      module.listUsers(authorization, { query: "LEARNER", status: "active" }),
    ).resolves.toMatchObject({
      items: [{ deviceCount: 1, email: "learner@example.test", id: account, status: "active" }],
      nextCursor: null,
    });
    await expect(module.usage(authorization)).resolves.toMatchObject({
      accounts: { active: 3, deleting: 0, disabled: 0, total: 3 },
      killSwitch: { enabled: false },
    });
    await expect(
      setup(outsider).module.access(setup(outsider).authorization),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    const stale = setup(operator, new Date("2026-08-13T05:44:59.999Z"));
    await expect(stale.module.access(stale.authorization)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      database.transaction(async (transaction) => {
        await transaction.exec("SET LOCAL ROLE huayi_context_setter");
        await transaction.query("SELECT admin_set_user_status($1,$2,'disabled',$3)", [
          operator,
          account,
          "99000000-0000-0000-0000-000000000001",
        ]);
      }),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("replays invitation creation without storing the clear token", async () => {
    const { authorization, module } = setup();
    const command = {
      body: { expiresInHours: 24 },
      idempotencyKey: "invite-1",
      type: "create-invitation" as const,
    };
    const first = await module.execute(authorization, command);
    const second = await module.execute(authorization, command);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ invitationPath: expect.stringMatching(/^\/join#[\w-]{43}$/u) });
    const rows = await database.query<{ token_hash: string }>("SELECT token_hash FROM invitations");
    expect(rows.rows).toHaveLength(1);
    expect(JSON.stringify(rows.rows)).not.toContain(
      String((first as { invitationPath: string }).invitationPath).slice(6),
    );
    await expect(
      module.execute(authorization, {
        body: { expiresInHours: 48 },
        idempotencyKey: "invite-1",
        type: "create-invitation",
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("hashes one recovered token with the current pepper and safely replays its path", async () => {
    const targetUser = "00000000-0000-0000-0000-000000000004";
    const invitationId = "70000000-0000-0000-0000-000000000001";
    await database.exec(`
      INSERT INTO invitations(id,token_hash,expires_at,created_by,created_by_kind,created_at)
      VALUES('${invitationId}',repeat('o',43),'2026-08-13T05:00:00Z','${operator}',
        'operator','2026-08-13T03:00:00Z');
      INSERT INTO invitation_claims(
        ticket_hash,invitation_id,expires_at,bound_user_id,bound_email,created_at
      ) VALUES(repeat('c',43),'${invitationId}','2026-08-13T05:00:00Z','${targetUser}',
        'recover@example.test','2026-08-13T04:00:00Z');
      INSERT INTO auth_flows(flow_hash,ticket_hash,expires_at,created_at)
      VALUES(repeat('f',43),repeat('c',43),'2026-08-13T05:00:00Z','2026-08-13T04:00:00Z');
      INSERT INTO auth.users(id,email,email_confirmed_at)
      VALUES('${targetUser}','recover@example.test',NULL);
      INSERT INTO auth.identities(id,user_id,provider)
      VALUES('recover-email','${targetUser}','email');
    `);
    const { authorization, module } = setup();
    const command = {
      body: {},
      id: invitationId,
      idempotencyKey: "recover-token-1",
      type: "recover-invitation-token" as const,
    };

    const first = await module.execute(authorization, command);
    await expect(module.execute(authorization, command)).resolves.toEqual(first);
    const token = (first as { invitationPath: string }).invitationPath.slice("/join#".length);
    const rows = await database.query<{ current_pepper_hash: boolean; old_hash: boolean }>(
      `SELECT token_hash=$2 AS current_pepper_hash,token_hash=repeat('o',43) AS old_hash
       FROM invitations WHERE id=$1`,
      [invitationId, hashSecret(token, "test-pepper")],
    );
    expect(rows.rows).toEqual([{ current_pepper_hash: true, old_hash: false }]);
    expect(
      JSON.stringify(await database.query("SELECT response FROM idempotency_records")),
    ).not.toContain(token);
  });

  it("projects invitation state and replays one content-free revocation audit", async () => {
    const { authorization, module } = setup();
    const created = (await module.execute(authorization, {
      body: { expiresInHours: 24 },
      idempotencyKey: "invite-for-revoke",
      type: "create-invitation",
    })) as { id: string };
    const revoke = {
      body: {},
      id: created.id,
      idempotencyKey: "revoke-1",
      type: "revoke-invitation" as const,
    };

    await expect(module.listInvitations(authorization, {})).resolves.toMatchObject({
      items: [{ consumedAt: null, id: created.id, revokedAt: null }],
    });
    const stale = setup(operator, new Date("2026-08-13T05:44:59.999Z"));
    await expect(stale.module.execute(stale.authorization, revoke)).rejects.toMatchObject({
      code: "forbidden",
    });
    const unauthorized = setup(outsider);
    await expect(
      unauthorized.module.execute(unauthorized.authorization, revoke),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(module.execute(authorization, revoke)).resolves.toEqual({
      id: created.id,
      revoked: true,
    });
    await expect(module.execute(authorization, revoke)).resolves.toEqual({
      id: created.id,
      revoked: true,
    });
    await expect(module.listInvitations(authorization, {})).resolves.toMatchObject({
      items: [{ consumedAt: null, id: created.id, revokedAt: now.toISOString() }],
    });

    const audit = await database.query<{ count: number; safe_details_empty: boolean }>(
      `SELECT count(*)::int AS count,bool_and(safe_details='{}'::jsonb) AS safe_details_empty
       FROM audit_events WHERE action='invitation.revoked' AND subject_id=$1`,
      [created.id],
    );
    expect(audit.rows).toEqual([{ count: 1, safe_details_empty: true }]);
    await expect(
      module.execute(authorization, { ...revoke, idempotencyKey: "revoke-2" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("atomically disables an account, expires access, audits once, and controls model availability", async () => {
    const { authorization, module } = setup();
    const disable = {
      body: { action: "disable" },
      id: account,
      idempotencyKey: "disable-1",
      type: "set-user-status" as const,
    };
    await expect(module.execute(authorization, disable)).resolves.toEqual({
      id: account,
      status: "disabled",
    });
    await expect(module.execute(authorization, disable)).resolves.toEqual({
      id: account,
      status: "disabled",
    });
    const state = await database.query<{
      extension_revoked: boolean;
      pairing_status: string;
      status: string;
      web_revoked: boolean;
    }>(
      `SELECT profiles.status,
        extensions.revoked_at IS NOT NULL AS extension_revoked,
        web.revoked_at IS NOT NULL AS web_revoked,pairings.status AS pairing_status
      FROM user_profiles profiles
      JOIN extension_sessions extensions ON extensions.user_id=profiles.user_id
      JOIN web_sessions web ON web.user_id=profiles.user_id
      JOIN extension_pairings pairings ON pairings.user_id=profiles.user_id
      WHERE profiles.user_id=$1`,
      [account],
    );
    expect(state.rows[0]).toEqual({
      extension_revoked: true,
      pairing_status: "expired",
      status: "disabled",
      web_revoked: true,
    });
    const audit = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM audit_events WHERE action='user.disabled' AND subject_id=$1",
      [account],
    );
    expect(audit.rows[0]?.count).toBe(1);
    await expect(
      module.execute(authorization, {
        body: { action: "disable" },
        id: operator,
        idempotencyKey: "self-disable",
        type: "set-user-status",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      module.execute(authorization, {
        body: { enabled: true },
        idempotencyKey: "kill-1",
        type: "set-kill-switch",
      }),
    ).resolves.toMatchObject({ enabled: true });
    await expect(
      database.query("SELECT reserve_quota($1,$2,$3,$4,$5)", [
        "40000000-0000-0000-0000-000000000001",
        operator,
        "50000000-0000-0000-0000-000000000001",
        1,
        "2026-08-13T07:00:00Z",
      ]),
    ).rejects.toThrow(/model unavailable/u);
  });

  it("sets only a UTC month grant and replays its strict quota projection", async () => {
    const { authorization, module } = setup();
    const command = {
      body: { limitMicroUsd: 2_000_000, periodStart: "2026-08-01T00:00:00.000Z" },
      id: account,
      idempotencyKey: "quota-1",
      type: "set-user-quota" as const,
    };
    await expect(module.execute(authorization, command)).resolves.toMatchObject({
      id: account,
      quota: {
        availableMicroUsd: 2_000_000,
        limitMicroUsd: 2_000_000,
        periodEnd: "2026-09-01T00:00:00.000Z",
        warning: "available",
      },
    });
    await expect(module.execute(authorization, command)).resolves.toMatchObject({
      quota: { limitMicroUsd: 2_000_000 },
    });
    await expect(
      module.execute(authorization, {
        ...command,
        body: { limitMicroUsd: 1, periodStart: "2026-08-02T00:00:00.000Z" },
        idempotencyKey: "quota-invalid",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});

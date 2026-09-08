import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import type { Sql, TransactionSql } from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createPostgresFoundationIdentity } from "./postgres-foundation-identity.js";
import { hashSecret, systemClock, systemSecrets } from "./security.js";

const pepper = "registration-timezone-test-pepper-at-least-32-characters";
let database: PGlite;

beforeAll(async () => {
  database = new PGlite();
  await database.exec(
    await readFile(new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url), "utf8"),
  );
  await database.exec(
    await readFile(
      new URL("../migrations/0003-password-auth-callback-method.sql", import.meta.url),
      "utf8",
    ),
  );
  await database.exec(`CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE TABLE auth.identities(id text PRIMARY KEY,user_id uuid,provider text);`);
  await database.exec(
    await readFile(
      new URL("../migrations/0013-password-signup-interruption-recovery.sql", import.meta.url),
      "utf8",
    ),
  );
});
afterAll(async () => database.close());

function identity() {
  const sql = {
    begin: <T>(operation: (sql: TransactionSql) => Promise<T>) =>
      database.transaction((transaction) =>
        operation((async (parts: TemplateStringsArray, ...parameters: unknown[]) => {
          const text = parts.reduce(
            (statement, part, index) => statement + (index ? `$${index}` : "") + part,
            "",
          );
          return (await transaction.query(text, parameters)).rows;
        }) as unknown as TransactionSql),
      ),
  } as unknown as Sql;
  return createPostgresFoundationIdentity({
    clock: systemClock,
    pepper,
    protectRefreshToken: (value) => value,
    secrets: systemSecrets,
    sql,
    webOrigin: "https://app.example.test",
  });
}

it.each(["password", "google", "password-recovery"] as const)(
  "persists Beijing time for new accounts created through %s registration",
  async (path) => {
    const userId = crypto.randomUUID();
    const email = `${userId}@example.test`;
    const token = crypto.randomUUID();
    await database.query(
      "INSERT INTO invitations(id,token_hash,expires_at,created_by) VALUES($1,$2,now()+interval '1 day',$3)",
      [crypto.randomUUID(), hashSecret(token, pepper), userId],
    );
    const authority = identity();
    const { claimTicket } = await authority.claimInvitation(token);
    await database.query("SELECT bind_auth_identity($1,$2)", [
      hashSecret(claimTicket, pepper),
      userId,
    ]);
    if (path === "password") {
      await authority.finalizeInvitation(claimTicket, userId, email, "password");
    } else {
      const { flowId } = await authority.createAuthFlow(claimTicket);
      if (path === "google") {
        await authority.completeAuthFlow(flowId, userId, email, "google");
      } else {
        await database.query("INSERT INTO auth.users VALUES($1,$2,now())", [userId, email]);
        await database.query("INSERT INTO auth.identities VALUES($1,$2,'email')", [userId, userId]);
        await database.query(
          "UPDATE invitation_claims SET expires_at=now()-interval '1 minute' WHERE ticket_hash=$1",
          [hashSecret(claimTicket, pepper)],
        );
        await database.query(
          "UPDATE auth_flows SET created_at=now()-interval '1 hour',expires_at=now()-interval '1 minute' WHERE flow_hash=$1",
          [hashSecret(flowId, pepper)],
        );
        await authority.resumeInterruptedPasswordRegistration(token, userId, email);
      }
    }
    expect(
      (
        await database.query("SELECT timezone,daily_goal FROM user_profiles WHERE user_id=$1", [
          userId,
        ])
      ).rows,
    ).toEqual([{ timezone: "Asia/Shanghai", daily_goal: 5 }]);
  },
);

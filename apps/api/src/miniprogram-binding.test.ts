import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const owner = "00000000-0000-4000-8000-000000000011";
let database: PGlite;
async function scalar(sql: string, args: unknown[] = []) {
  return (await database.query<{ value: unknown }>(sql, args)).rows[0]?.value;
}
beforeAll(async () => {
  database = new PGlite();
  for (const name of ["0001-cloud-v1-foundation", "0029-wechat-miniprogram"]) {
    await database.exec(
      await readFile(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"),
    );
  }
  await database.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'friend@example.com','active','Asia/Shanghai',5)",
    [owner],
  );
  await database.query(
    "INSERT INTO account_sign_in_methods(owner_user_id,method) VALUES($1,'password')",
    [owner],
  );
  await database.query(
    "INSERT INTO web_sessions(id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,expires_at,reauthenticated_method) VALUES($1,$2,$2,'web-proof','csrf','encrypted',now()+interval '1 hour','password')",
    [crypto.randomUUID(), owner],
  );
});
afterAll(async () => database?.close());
const start = (subject: string, ticket: string) =>
  scalar("SELECT begin_wechat_login('wx-test',$1,$2,$2,$3,$4) value", [
    subject,
    ticket,
    crypto.randomUUID(),
    crypto.randomUUID(),
  ]);
const finish = (ticket: string) =>
  scalar("SELECT complete_wechat_onboarding($1,'linked',$2,$3,$4) value", [
    ticket,
    crypto.randomUUID(),
    crypto.randomUUID(),
    `token-${ticket}`,
  ]);

describe("first-use WeChat account binding", () => {
  it("requires a fresh Web proof and the exact initiating ticket; no record copying", async () => {
    await start("friend", "friend-ticket");
    expect(await finish("friend-ticket")).toBeNull();
    expect(
      await scalar("SELECT approve_wechat_binding('friend-ticket','wrong-proof',$1) value", [
        owner,
      ]),
    ).toBe(false);
    await database.exec("UPDATE web_sessions SET reauthenticated_at=now()-interval '16 minutes'");
    expect(
      await scalar("SELECT approve_wechat_binding('friend-ticket','web-proof',$1) value", [owner]),
    ).toBe(false);
    await database.exec("UPDATE web_sessions SET reauthenticated_at=now()");
    expect(
      await scalar("SELECT approve_wechat_binding('friend-ticket','web-proof',$1) value", [owner]),
    ).toBe(true);
    expect(await scalar("SELECT wechat_binding_status('friend-ticket') value")).toBe("approved");
    expect(await finish("wrong-ticket")).toBeNull();
    expect(await finish("friend-ticket")).toMatchObject({ state: "authenticated" });
    expect(
      await scalar("SELECT authenticate_miniprogram_session('token-friend-ticket') value"),
    ).toMatchObject({ userId: owner });
    expect(await scalar("SELECT count(*)::integer value FROM user_profiles")).toBe(1);
    expect(await finish("friend-ticket")).toBeNull();
    await start("second-friend", "other-ticket");
    expect(
      await scalar("SELECT approve_wechat_binding('other-ticket','web-proof',$1) value", [owner]),
    ).toBe(false);
  });
  it("rejects expired tickets and erases outstanding approvals on a security event", async () => {
    const next = crypto.randomUUID();
    await database.query(
      "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'next@example.com','active','Asia/Shanghai',5)",
      [next],
    );
    await database.query(
      "INSERT INTO web_sessions(id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,expires_at,reauthenticated_method) VALUES($1,$2,$2,'next-web','csrf','encrypted',now()+interval '1 hour','google')",
      [crypto.randomUUID(), next],
    );
    await start("next", "next-ticket");
    expect(
      await scalar("SELECT approve_wechat_binding('next-ticket','next-web',$1) value", [next]),
    ).toBe(true);
    await database.query("UPDATE user_profiles SET status='disabled' WHERE user_id=$1", [next]);
    await database.query("UPDATE user_profiles SET status='active' WHERE user_id=$1", [next]);
    expect(await finish("next-ticket")).toBeNull();
    await database.exec(
      "UPDATE wechat_onboarding SET expires_at=now()-interval '1 second' WHERE ticket_hash='other-ticket'",
    );
    expect(await scalar("SELECT wechat_binding_status('other-ticket') value")).toBeNull();
    expect(await finish("other-ticket")).toBeNull();
  });
  it("snapshots whether deletion needs the external Auth provider", async () => {
    const pure = crypto.randomUUID();
    await start("pure", "pure-ticket");
    await scalar(
      "SELECT complete_wechat_onboarding('pure-ticket','independent',$1,$2,'pure-token') value",
      [pure, crypto.randomUUID()],
    );
    for (const [id, required] of [
      [owner, true],
      [pure, false],
    ] as const) {
      await database.query(
        "INSERT INTO account_deletion_jobs(id,subject_user_id,subject_hash,state,stage,request_key_hash,request_hash,ack_expires_at,requested_at,updated_at) VALUES($1,$2::uuid,$2::text,'requested','requested','key',repeat('a',64),now()+interval '1 hour',now(),now())",
        [crypto.randomUUID(), id],
      );
      expect(
        await scalar(
          "SELECT delete_auth_user value FROM account_deletion_jobs WHERE subject_user_id=$1",
          [id],
        ),
      ).toBe(required);
    }
  });
});

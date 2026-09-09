import { readFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCurrentDatabaseFixture } from "./test-support/current-database-fixture.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
let database: PGlite;
async function scalar(sql: string, args: unknown[] = []) {
  return (await database.query<{ value: unknown }>(sql, args)).rows[0]?.value;
}
beforeAll(async () => {
  database = await createCurrentDatabaseFixture();
});
afterAll(async () => database?.close());
describe("WeChat account authority", () => {
  it.each([
    ["0029-wechat-miniprogram.sql", "20260909010000_wechat_miniprogram.sql"],
    ["0030-word-archive.sql", "20260909020000_word_archive.sql"],
  ])("keeps both migration tracks identical: %s", async (api, supabase) => {
    expect(
      await readFile(new URL(`../../../supabase/migrations/${supabase}`, import.meta.url), "utf8"),
    ).toBe(await readFile(new URL(`../migrations/${api}`, import.meta.url), "utf8"));
  });
  it("opens an account without email or a Supabase identity and grants quota only once", async () => {
    expect(
      await scalar(
        "SELECT begin_wechat_login('wx-test','subject','ticket','binding',$1,'unused-token') value",
        [crypto.randomUUID()],
      ),
    ).toMatchObject({ state: "onboarding" });
    expect(
      await scalar(
        "SELECT complete_wechat_onboarding('ticket','independent',$1,$2,'token') value",
        [userId, crypto.randomUUID()],
      ),
    ).toMatchObject({ state: "authenticated" });
    expect(
      (
        await database.query(
          "SELECT email,timezone,daily_goal FROM user_profiles WHERE user_id=$1",
          [userId],
        )
      ).rows,
    ).toEqual([{ email: null, timezone: "Asia/Shanghai", daily_goal: 5 }]);
    expect(
      await scalar("SELECT count(*)::integer value FROM quota_grants WHERE user_id=$1", [userId]),
    ).toBe(1);
    expect(
      await scalar(
        "SELECT complete_wechat_onboarding('ticket','independent',$1,$2,'replay') value",
        [otherId, crypto.randomUUID()],
      ),
    ).toBeNull();
    expect(await scalar("SELECT authenticate_miniprogram_session('token') value")).toMatchObject({
      userId,
      reauthenticatedAt: null,
    });
  });
  it("cannot substitute another WeChat identity during recent authentication", async () => {
    expect(
      await scalar(
        "SELECT reauthenticate_miniprogram_session('token','wx-test','other-subject') value",
      ),
    ).toBe(false);
    expect(
      await scalar("SELECT reauthenticate_miniprogram_session('token','wx-test','subject') value"),
    ).toBe(true);
  });
  it("does not grant runtime direct access to identity/session tables or anonymous function execution", async () => {
    for (const table of ["wechat_identities", "wechat_onboarding", "miniprogram_sessions"]) {
      expect(
        await scalar("SELECT has_table_privilege('huayi_context_setter',$1,'SELECT') value", [
          table,
        ]),
      ).toBe(false);
      expect(
        await scalar("SELECT has_table_privilege('huayi_business',$1,'INSERT') value", [table]),
      ).toBe(false);
    }
    for (const signature of [
      "begin_wechat_login(text,text,text,text,uuid,text)",
      "complete_wechat_onboarding(text,text,uuid,uuid,text)",
      "wechat_binding_status(text)",
      "approve_wechat_binding(text,text,uuid)",
      "authenticate_miniprogram_session(text)",
      "reauthenticate_miniprogram_session(text,text,text)",
      "revoke_miniprogram_session(text)",
      "miniprogram_deletion_auth_required(uuid,text)",
      "prune_miniprogram_auth()",
      "begin_idempotent_write(uuid,text,text,text)",
    ]) {
      for (const role of [
        "anon",
        "authenticated",
        "service_role",
        "huayi_business",
        "huayi_context_setter",
      ]) {
        expect(
          await scalar("SELECT has_function_privilege($1,$2,'EXECUTE') value", [role, signature]),
          `${role}: ${signature}`,
        ).toBe(role === "huayi_context_setter");
      }
    }
  });
  it("revokes only this mini-program session on logout and all of them on account disable", async () => {
    expect(
      await scalar(
        "SELECT begin_wechat_login('wx-test','subject','new-ticket','new-binding',$1,'token-2') value",
        [crypto.randomUUID()],
      ),
    ).toMatchObject({ state: "authenticated" });
    await scalar("SELECT revoke_miniprogram_session('token') value");
    expect(await scalar("SELECT authenticate_miniprogram_session('token') value")).toBeNull();
    expect(await scalar("SELECT authenticate_miniprogram_session('token-2') value")).toMatchObject({
      userId,
    });
    await database.query("UPDATE user_profiles SET status='disabled' WHERE user_id=$1", [userId]);
    expect(await scalar("SELECT authenticate_miniprogram_session('token-2') value")).toBeNull();
    expect(
      await scalar(
        "SELECT begin_wechat_login('wx-test','subject','disabled-ticket','disabled-code',$1,'token-3') value",
        [crypto.randomUUID()],
      ),
    ).toBeNull();
  });
});

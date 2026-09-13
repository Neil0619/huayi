import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createCurrentDatabaseFixture } from "./test-support/current-database-fixture.js";
import type { PGlite } from "@electric-sql/pglite";

let database: PGlite | undefined;
afterEach(async () => database?.close());
describe("account export publication authority", () => {
  it("keeps both forward migrations identical in the API and deployable Supabase chain", async () => {
    for (const [api, supabase] of [
      ["0032-structured-account-exports.sql", "20260913010000_structured_account_exports.sql"],
      ["0033-account-export-publication.sql", "20260913020000_account_export_publication.sql"],
    ])
      expect(await readFile(new URL(`../migrations/${api}`, import.meta.url), "utf8")).toBe(
        await readFile(
          new URL(`../../../supabase/migrations/${supabase}`, import.meta.url),
          "utf8",
        ),
      );
  });

  it("limits publication/cleanup functions and keeps candidate records private", async () => {
    const db = (database = await createCurrentDatabaseFixture());
    for (const signature of [
      "claim_account_export(text,timestamptz)",
      "claim_account_export_v2(text,timestamptz)",
      "prepare_account_export_upload(uuid,text,text)",
      "complete_account_export(uuid,text,integer,bigint,text,text,timestamptz)",
      "reconcile_account_export_publication(uuid,text,text,integer,bigint,text)",
      "claim_account_export_candidate_cleanup()",
      "finish_account_export_candidate_cleanup(text)",
      "claim_account_deletion_v2(text,timestamptz)",
      "finish_account_export_deletion(uuid,text)",
    ]) {
      for (const role of [
        "anon",
        "authenticated",
        "service_role",
        "huayi_business",
        "huayi_context_setter",
      ])
        expect(
          (
            await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [
              role,
              signature,
            ])
          ).rows,
        ).toEqual([{ allowed: role === "huayi_context_setter" }]);
    }
    for (const role of [
      "anon",
      "authenticated",
      "service_role",
      "huayi_business",
      "huayi_context_setter",
    ])
      expect(
        (
          await db.query(
            "SELECT has_table_privilege($1,'huayi_private.account_export_candidates','SELECT,INSERT,UPDATE,DELETE') allowed",
            [role],
          )
        ).rows,
      ).toEqual([{ allowed: false }]);
  });

  it("allows one legacy attempt and fences reclaimed, foreign-key and deleting-account publications", async () => {
    const db = (database = await createCurrentDatabaseFixture());
    const owner = "00000000-0000-0000-0000-000000000001";
    const id = "10000000-0000-4000-8000-000000000001";
    await db.query(
      "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'offline@example.test','active','UTC',5)",
      [owner],
    );
    await db.query(
      "INSERT INTO account_data_export_jobs(id,owner_user_id,state,format_version) VALUES($1,$2,'pending',1)",
      [id, owner],
    );
    await db.query("UPDATE user_profiles SET status='disabled' WHERE user_id=$1", [owner]);
    expect(
      (await db.query("SELECT * FROM claim_account_export('legacy',now()+interval '2 minutes')"))
        .rows,
    ).toHaveLength(1);
    await db.query(
      "UPDATE account_data_export_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    expect(
      (
        await db.query(
          "SELECT * FROM claim_account_export('legacy-again',now()+interval '2 minutes')",
        )
      ).rows,
    ).toEqual([]);
    const active = (
      await db.query<{ object_key: string }>(
        "SELECT * FROM claim_account_export_v2('new',now()+interval '2 minutes')",
      )
    ).rows[0];
    if (!active) throw new Error("Missing native takeover");
    expect(active.object_key).not.toBe(`account-exports/${id}.ndjson`);
    for (const [lease, key] of [
      ["legacy", `account-exports/${id}.ndjson`],
      ["new", "account-exports/foreign.ndjson"],
    ])
      expect(
        (
          await db.query(
            "SELECT complete_account_export($1,$2,1,1,$3,$4,now()+interval '1 day') done",
            [id, lease, "a".repeat(64), key],
          )
        ).rows,
      ).toEqual([{ done: false }]);
    await db.query("UPDATE user_profiles SET status='deleting' WHERE user_id=$1", [owner]);
    expect(
      (
        await db.query("SELECT prepare_account_export_upload($1,'new',$2) done", [
          id,
          active.object_key,
        ])
      ).rows,
    ).toEqual([{ done: false }]);
    expect(
      (
        await db.query(
          "SELECT complete_account_export($1,'new',1,1,$2,$3,now()+interval '1 day') done",
          [id, "a".repeat(64), active.object_key],
        )
      ).rows,
    ).toEqual([{ done: false }]);
  });
});

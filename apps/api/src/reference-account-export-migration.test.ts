import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createCurrentDatabaseFixture } from "./test-support/current-database-fixture.js";

const owner = "00000000-0000-0000-0000-000000000001";
const id = "20000000-0000-0000-0000-000000000001";
let db: PGlite;
beforeEach(async () => {
  db = await createCurrentDatabaseFixture();
  await db.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'offline@example.test','active','UTC',5)",
    [owner],
  );
});
afterEach(async () => db.close());

it("mirrors the forward reference export migration and restricts the new reference export worker authority", async () => {
  const sql = await readFile(
    new URL("../migrations/0038-reference-account-exports.sql", import.meta.url),
    "utf8",
  );
  expect(
    await readFile(
      new URL(
        "../../../supabase/migrations/20260913120000_reference_account_exports.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ).toBe(sql);
  for (const role of ["anon", "authenticated", "service_role", "huayi_business"]) {
    expect(
      (
        await db.query(
          "SELECT has_function_privilege($1,'claim_account_export_v4(text,timestamptz)','EXECUTE') allowed",
          [role],
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
  }
  expect(
    (
      await db.query(
        "SELECT has_function_privilege('huayi_context_setter','claim_account_export_v4(text,timestamptz)','EXECUTE') allowed",
      )
    ).rows,
  ).toEqual([{ allowed: true }]);
});

it.each(["pending", "running"] as const)(
  "an old worker cannot claim a format 4 %s job, including expired leases",
  async (state) => {
    await db.query(
      "INSERT INTO account_data_export_jobs(id,owner_user_id,state,format_version,lease_token_hash,lease_expires_at) VALUES($1,$2,$3,4,$4,$5)",
      [
        id,
        owner,
        state,
        state === "running" ? "old" : null,
        state === "running" ? new Date(Date.now() - 1000) : null,
      ],
    );
    expect(
      (await db.query("SELECT * FROM claim_account_export_v3('v2',now()+interval '2 minutes')"))
        .rows,
    ).toEqual([]);
    const first = (
      await db.query<{ id: string; format_version: number; object_key: string }>(
        "SELECT * FROM claim_account_export_v4('v3',now()+interval '2 minutes')",
      )
    ).rows[0];
    expect(first).toMatchObject({ id, format_version: 4 });
    expect(
      (
        await db.query(
          "SELECT object_key FROM huayi_private.account_export_candidates WHERE export_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ object_key: first?.object_key }]);
    await db.query(
      "UPDATE account_data_export_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    expect(
      (
        await db.query(
          "SELECT * FROM claim_account_export_v3('stale-v2',now()+interval '2 minutes')",
        )
      ).rows,
    ).toEqual([]);
    const next = (
      await db.query<{ object_key: string }>(
        "SELECT * FROM claim_account_export_v4('new-v3',now()+interval '2 minutes')",
      )
    ).rows[0];
    expect(next?.object_key).not.toBe(first?.object_key);
    expect(
      (
        await db.query("SELECT prepare_account_export_upload($1,'v3',$2) prepared", [
          id,
          first?.object_key,
        ])
      ).rows,
    ).toEqual([{ prepared: false }]);
  },
);

it.each([1, 2])("the v3 capability still claims format %s", async (format) => {
  await db.query(
    "INSERT INTO account_data_export_jobs(id,owner_user_id,state,format_version) VALUES($1,$2,'pending',$3)",
    [id, owner, format],
  );
  expect(
    (
      await db.query(
        "SELECT id,format_version FROM claim_account_export_v3('v2',now()+interval '2 minutes')",
      )
    ).rows,
  ).toEqual([{ id, format_version: format }]);
});

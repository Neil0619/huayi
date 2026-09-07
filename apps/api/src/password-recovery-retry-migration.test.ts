import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";

const migration = new URL(
  "../migrations/0028-password-recovery-correctable-retry.sql",
  import.meta.url,
);
let database: PGlite;

beforeEach(async () => {
  database = new PGlite();
  await database.waitReady;
  await database.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;",
  );
  await database.exec(
    await readFile(new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url), "utf8"),
  );
  await database.exec(await readFile(migration, "utf8"));
  await database.exec(`
    INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','learner@example.test','active','UTC',5);
    INSERT INTO account_sign_in_methods(owner_user_id,method) VALUES('71000000-0000-4000-8000-000000000001','password');
    SELECT request_password_recovery('learner@example.test','flow','protected-flow',now()+interval '30 minutes',now());
    SELECT claim_password_recovery_dispatch('dispatch',now()+interval '1 minute',now());
    SELECT mark_password_recovery_dispatched('flow','dispatch',now());
    SELECT save_password_recovery_sent('flow','dispatch','provider-state',now());
    SELECT complete_password_recovery_callback('flow','71000000-0000-4000-8000-000000000001','learner@example.test','verified-state','browser','csrf',now()+interval '15 minutes',now());
    SELECT claim_password_recovery_completion('browser','csrf','lease',now()+interval '30 seconds',now());
  `);
});
afterEach(async () => database.close());

it("ships the same SQL in both migration trees and restricts the new capability", async () => {
  expect(
    await readFile(
      new URL(
        "../../../supabase/migrations/20260907030000_password_recovery_correctable_retry.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ).toBe(await readFile(migration, "utf8"));
  for (const role of [
    "anon",
    "authenticated",
    "service_role",
    "huayi_business",
    "huayi_runtime",
    "huayi_context_setter",
  ]) {
    expect(
      (
        await database.query(
          "SELECT has_function_privilege($1,'release_password_recovery_completion(text,text,timestamptz)','EXECUTE') AS allowed",
          [role],
        )
      ).rows,
    ).toEqual([{ allowed: role === "huayi_context_setter" }]);
  }
  expect(
    (
      await database.query(
        "SELECT prosecdef,proconfig FROM pg_proc WHERE oid='release_password_recovery_completion(text,text,timestamptz)'::regprocedure",
      )
    ).rows,
  ).toEqual([{ prosecdef: true, proconfig: ["search_path=pg_catalog"] }]);
});

it("keeps the same browser proof and deadlines after a rejected password", async () => {
  const before = (
    await database.query(
      "SELECT recovery_session_hash,csrf_hash,expires_at,browser_expires_at FROM password_recovery_flows",
    )
  ).rows;
  expect(
    (
      await database.query(
        "SELECT release_password_recovery_completion('flow','lease',now()) AS released",
      )
    ).rows,
  ).toEqual([{ released: true }]);
  expect(
    (
      await database.query(
        "SELECT recovery_session_hash,csrf_hash,expires_at,browser_expires_at FROM password_recovery_flows",
      )
    ).rows,
  ).toEqual(before);
  expect(
    (
      await database.query(
        "SELECT stage FROM claim_password_recovery_completion('browser','csrf','next-lease',now()+interval '30 seconds',now())",
      )
    ).rows,
  ).toEqual([{ stage: "verified" }]);
  expect(
    (
      await database.query(
        "SELECT release_password_recovery_completion('flow','lease',now()) AS released",
      )
    ).rows,
  ).toEqual([{ released: null }]);
});

it("cannot release expired capabilities or a lease after provider completion", async () => {
  for (const change of [
    "completion_lease_expires_at=now()-interval '1 second'",
    "browser_expires_at=now()-interval '1 second'",
    "created_at=now()-interval '1 hour',expires_at=now()-interval '1 second'",
    "stage='provider-updated'",
  ]) {
    await database.exec(`BEGIN; UPDATE password_recovery_flows SET ${change};`);
    expect(
      (
        await database.query(
          "SELECT release_password_recovery_completion('flow','lease',now()) AS released",
        )
      ).rows,
    ).toEqual([{ released: null }]);
    await database.exec("ROLLBACK;");
  }
});

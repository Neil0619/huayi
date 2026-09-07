import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";

const baseline = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const migration = new URL("../migrations/0026-email-first-password-signup.sql", import.meta.url);
const mirrored = new URL(
  "../../../supabase/migrations/20260907010000_email_first_password_signup.sql",
  import.meta.url,
);
let database: PGlite;

beforeEach(async () => {
  database = new PGlite();
  await database.waitReady;
  await database.exec(await readFile(baseline, "utf8"));
  await database.exec(
    await readFile(
      new URL("../migrations/0003-password-auth-callback-method.sql", import.meta.url),
      "utf8",
    ),
  );
  await database.exec(await readFile(migration, "utf8"));
  await database.exec(`
    INSERT INTO invitations(id,token_hash,expires_at,created_by)
      VALUES('61000000-0000-4000-8000-000000000001',repeat('i',43),now()+interval '1 day','63000000-0000-4000-8000-000000000001');
    SELECT claim_invitation(repeat('i',43),repeat('c',43),now()+interval '15 minutes');
    SELECT create_auth_flow(repeat('c',43),repeat('f',43),now()+interval '15 minutes');
    SELECT bind_auth_identity(repeat('c',43),'62000000-0000-4000-8000-000000000001');
    SELECT save_auth_flow_state(repeat('f',43),'encrypted-pending');
  `);
});
afterEach(async () => database.close());

it("keeps both migrations identical", async () => {
  expect(await readFile(mirrored, "utf8")).toBe(await readFile(migration, "utf8"));
});
it("allows only one transition from the expected state", async () => {
  const update = () =>
    database.query(
      "SELECT compare_password_signup_state(repeat('f',43),'encrypted-pending','encrypted-verified') AS saved",
    );
  expect((await update()).rows).toEqual([{ saved: true }]);
  expect((await update()).rows).toEqual([{ saved: null }]);
  expect(
    (await database.query("SELECT read_auth_flow_state(repeat('f',43)) AS state")).rows,
  ).toEqual([{ state: "encrypted-verified" }]);
});
it("recovers an expired short claim only through an atomic state transition", async () => {
  await database.exec(
    "UPDATE auth_flows SET created_at=now()-interval '1 hour',expires_at=now()-interval '1 second'; UPDATE invitation_claims SET expires_at=now()-interval '1 second'",
  );
  expect(
    (await database.query("SELECT read_password_signup_state(repeat('f',43)) AS state")).rows,
  ).toEqual([{ state: "encrypted-pending" }]);
  expect(
    (
      await database.query(
        "SELECT compare_password_signup_state(repeat('f',43),'encrypted-pending','encrypted-verified') AS saved",
      )
    ).rows,
  ).toEqual([{ saved: true }]);
  expect(
    (
      await database.query(
        "SELECT expires_at>now() AND expires_at<=now()+interval '15 minutes' AS renewed FROM invitation_claims",
      )
    ).rows,
  ).toEqual([{ renewed: true }]);
  expect(
    (
      await database.query(
        "SELECT complete_auth_flow(repeat('f',43),'62000000-0000-4000-8000-000000000001','learner@example.com','UTC',5,'password')::text AS id",
      )
    ).rows,
  ).toEqual([{ id: "62000000-0000-4000-8000-000000000001" }]);
  expect((await database.query("SELECT method FROM account_sign_in_methods")).rows).toEqual([
    { method: "password" },
  ]);
  expect(
    (await database.query("SELECT read_password_signup_state(repeat('f',43)) AS state")).rows,
  ).toEqual([{ state: null }]);
});
it("rejects old, consumed, unbound, expired-invitation and revoked registrations", async () => {
  for (const invalidate of [
    "UPDATE auth_flows SET consumed_at=now()",
    "UPDATE invitation_claims SET created_at=now()-interval '25 hours'",
    "UPDATE invitation_claims SET bound_user_id=NULL",
    "UPDATE invitations SET created_at=now()-interval '1 day',expires_at=now()-interval '1 second'",
    "UPDATE invitations SET revoked_at=now()",
    "UPDATE invitations SET consumed_at=now()",
  ]) {
    await database.exec(`BEGIN; ${invalidate};`);
    expect(
      (
        await database.query(
          "SELECT compare_password_signup_state(repeat('f',43),'encrypted-pending','encrypted-verified') AS saved",
        )
      ).rows,
    ).toEqual([{ saved: null }]);
    expect(
      (await database.query("SELECT read_password_signup_state(repeat('f',43)) AS state")).rows,
    ).toEqual([{ state: null }]);
    await database.exec("ROLLBACK;");
  }
});
it("grants the transition only to the context setter", async () => {
  expect(
    (
      await database.query(`SELECT
    has_function_privilege('huayi_context_setter','compare_password_signup_state(text,text,text)','EXECUTE') AS trusted,
    has_function_privilege('huayi_business','compare_password_signup_state(text,text,text)','EXECUTE') AS business,
    has_function_privilege('huayi_runtime','compare_password_signup_state(text,text,text)','EXECUTE') AS runtime
  `)
    ).rows,
  ).toEqual([{ trusted: true, business: false, runtime: false }]);
  expect(
    (
      await database.query(
        "SELECT has_function_privilege('huayi_context_setter','read_password_signup_state(text)','EXECUTE') AS trusted,has_function_privilege('huayi_business','read_password_signup_state(text)','EXECUTE') AS business,has_function_privilege('huayi_runtime','read_password_signup_state(text)','EXECUTE') AS runtime",
      )
    ).rows,
  ).toEqual([{ trusted: true, business: false, runtime: false }]);
});

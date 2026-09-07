import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, afterEach, expect, it } from "vitest";
import { createPostgresDiagnostics } from "./postgres-diagnostics.js";
const migration = new URL("../migrations/0027-error-diagnostics.sql", import.meta.url);
let db: PGlite;
const repository = () =>
  createPostgresDiagnostics(
    {
      transaction: async () => {
        throw new Error("Unexpected owner transaction");
      },
      trusted: (operation) =>
        operation({
          rows: async <Row>(text: string, parameters: readonly unknown[] = []) =>
            (await db.query<Row>(text, [...parameters])).rows,
        }),
    },
    new Uint8Array(32).fill(7),
  );
const owner = "71000000-0000-4000-8000-000000000001";
const operator = "71000000-0000-4000-8000-000000000002";
const event = {
  version: 1,
  id: owner,
  occurredAt: new Date().toISOString(),
  source: "store",
  severity: "error",
  operation: "instant-query",
  code: "provider-error",
  stage: "http",
  httpStatus: 429,
};
beforeEach(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;",
  );
  await db.exec(
    await readFile(new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    await readFile(
      new URL("../migrations/0024-durable-learning-tasks.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(await readFile(migration, "utf8"));
  await db.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'learner@example.com','active','UTC',5),($2,$2,'operator@example.com','active','UTC',5)",
    [owner, operator],
  );
  await db.query("INSERT INTO admin_roles(user_id,role) VALUES($1,'operator')", [operator]);
});
afterEach(async () => db.close());
it("mirrors SQL and denies public roles, direct tables and ordinary users", async () => {
  expect(
    await readFile(
      new URL("../../../supabase/migrations/20260907020000_error_diagnostics.sql", import.meta.url),
      "utf8",
    ),
  ).toBe(await readFile(migration, "utf8"));
  for (const role of ["anon", "authenticated", "service_role", "huayi_business", "huayi_runtime"]) {
    const result = await db.query(
      "SELECT has_table_privilege($1,'error_diagnostics','SELECT') AS table_access,has_function_privilege($1,'record_error_diagnostics(uuid,jsonb)','EXECUTE') AS write_access,has_function_privilege($1,'admin_error_diagnostics(uuid,jsonb,jsonb,integer)','EXECUTE') AS read_access",
      [role],
    );
    expect(result.rows).toEqual([{ table_access: false, write_access: false, read_access: false }]);
  }
  await expect(
    db.query("SELECT admin_error_diagnostics($1,'{}',null,20)", [owner]),
  ).rejects.toThrow("administrator required");
});
it("deduplicates retries, filters and counts all matching events before pagination", async () => {
  for (let n = 0; n < 2; n++)
    await db.query("SELECT record_error_diagnostics($1,$2::jsonb)", [
      owner,
      JSON.stringify([event]),
    ]);
  const read = await db.query<{
    result: { items: unknown[]; summary: { events: number; affectedUsers: number } };
  }>("SELECT admin_error_diagnostics($1,'{}',null,20) AS result", [operator]);
  expect(read.rows[0]?.result.items).toHaveLength(1);
  expect(read.rows[0]?.result.summary).toMatchObject({ events: 1, affectedUsers: 1 });
  expect(
    (
      await db.query<{ result: { items: unknown[] } }>(
        'SELECT admin_error_diagnostics($1,\'{"source":"api"}\',null,20) AS result',
        [operator],
      )
    ).rows[0]?.result.items,
  ).toEqual([]);
  await db.exec("UPDATE error_diagnostics SET received_at=now()-interval '31 days'");
  await db.exec("SELECT purge_error_diagnostics()");
  expect((await db.query("SELECT count(*)::int AS n FROM error_diagnostics")).rows).toEqual([
    { n: 0 },
  ]);
});
it("collects failed and abandoned tasks even when the original worker left no log", async () => {
  await db.query(
    "INSERT INTO learning_tasks(id,owner_user_id,idempotency_key,request_hash,command,kind,priority,state,error_code) VALUES($1,$2,'key',repeat('a',64),'{\"version\":2}', 'instant-query',0,'unknown','outcome_unknown')",
    [operator, owner],
  );
  await db.exec("SELECT purge_error_diagnostics(); SELECT purge_error_diagnostics();");
  expect(
    (
      await db.query(
        "SELECT event->>'code' AS code,event->>'taskId' AS task FROM error_diagnostics",
      )
    ).rows,
  ).toEqual([{ code: "outcome_unknown", task: operator }]);
});
it("serves validated pages and rejects stale administrator authentication", async () => {
  await db.query("SELECT record_error_diagnostics($1,$2::jsonb)", [
    owner,
    JSON.stringify([event, { ...event, id: operator }]),
  ]);
  const auth = { actorUserId: operator, reauthenticatedAt: new Date() };
  const first = await repository().list(auth, { days: "7", limit: 1 });
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).not.toBeNull();
  expect(first.summary.events).toBe(2);
  const second = await repository().list(auth, {
    days: "7",
    limit: 1,
    cursor: first.nextCursor ?? "",
  });
  expect(second.items).toHaveLength(1);
  expect(second.items[0]?.event.id).not.toBe(first.items[0]?.event.id);
  expect(second.nextCursor).toBeNull();
  await expect(
    repository().list(
      { ...auth, reauthenticatedAt: new Date(Date.now() - 16 * 60_000) },
      { days: "7" },
    ),
  ).rejects.toThrow("Recent operator authentication");
});

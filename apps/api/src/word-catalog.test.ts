import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { createWordCatalog } from "./word-catalog.js";
import { createWordLibraryModule } from "./word-library-module.js";
import { createPostgresWordLibrary } from "./postgres-word-library.js";
import { createPostgresAccountDataExportSource } from "./postgres-account-data-export-source.js";
let db: PGlite;
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
beforeAll(async () => {
  db = new PGlite();
  for (const name of ["0001-cloud-v1-foundation", "0030-word-archive"])
    await db.exec(await readFile(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
  for (const id of [owner, other])
    await db.query(
      "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,$2,'active','Asia/Shanghai',5)",
      [id, `${id}@example.test`],
    );
});
afterAll(async () => db?.close());
it("archives without erasing contexts, preserves V1 shape, prevents cross-account writes, and replays safely", async () => {
  const database = createPgliteAnalysisDatabase(db);
  const catalog = createWordCatalog({
    database,
    cursorKey: Buffer.alloc(32, 1),
    now: () => new Date(),
  });
  const legacy = createWordLibraryModule({
    repository: createPostgresWordLibrary(database),
    cursorKey: Buffer.alloc(32, 1),
    ids: () => crypto.randomUUID(),
    now: () => new Date(),
  });
  const created = await legacy.upsert(owner, "create-word", {
    headword: "remember",
    context: { sourceText: "Remember this word." },
  });
  const id = created.word.id;
  await expect(
    catalog.archive(other, id, "other-archive", { archived: true, expectedRevision: 1 }),
  ).rejects.toMatchObject({ code: "not_found" });
  const archived = await catalog.archive(owner, id, "archive-word", {
    archived: true,
    expectedRevision: 1,
  });
  expect(archived.archivedAt).not.toBeNull();
  expect((await catalog.list(owner, {})).items).toEqual([]);
  expect((await catalog.list(owner, { archived: true })).items[0]?.word.id).toBe(id);
  expect(
    await catalog.archive(owner, id, "archive-word", { archived: true, expectedRevision: 1 }),
  ).toEqual(archived);
  expect((await legacy.get(owner, id, {}))?.contexts.items).toHaveLength(1);
  expect((await legacy.get(owner, id, {}))?.word).not.toHaveProperty("archivedAt");
  const records = await createPostgresAccountDataExportSource(database).records(
    owner,
    new Date().toISOString(),
  );
  expect(records.find((record) => record.recordType === "word")).toHaveProperty(
    "archivedAt",
    archived.archivedAt,
  );
  await expect(
    catalog.archive(owner, id, "stale-restore", { archived: false, expectedRevision: 1 }),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  await catalog.archive(owner, id, "restore-word", {
    archived: false,
    expectedRevision: archived.word.revision,
  });
  expect((await catalog.list(owner, {})).items[0]?.word.id).toBe(id);
});

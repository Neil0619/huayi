import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createBackfillState } from "@huayi/cloud-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCurrentDatabaseFixture } from "./test-support/current-database-fixture.js";
import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresShanbayBackfill } from "./postgres-shanbay-backfill.js";
import { createPostgresExternalWordbook } from "./postgres-external-wordbook.js";
import { createExternalWordbookModule } from "./external-wordbook-module.js";
import { createPostgresAccountDataExportSource } from "./postgres-account-data-export-source.js";
import { saveBackfillState } from "./postgres-shanbay-backfill-state.js";

const owner = "00000000-0000-4000-8000-000000000001";
let db: PGlite;
function adapter(database: PGlite): AnalysisDatabase {
  const transaction: AnalysisDatabase["transaction"] = (owner, operation) =>
    database.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE huayi_context_setter");
      await tx.query("SELECT huayi_private.set_owner_context($1)", [owner]);
      const role = (name: string): AnalysisQuery => ({
        rows: async <Row>(sql: string, parameters: readonly unknown[] = []) => {
          await tx.exec(`SET LOCAL ROLE ${name}`);
          return (await tx.query<Row>(sql, [...parameters])).rows;
        },
      });
      return operation({ tenant: role("huayi_business"), trusted: role("huayi_context_setter") });
    });
  return {
    transaction,
    snapshot: transaction,
    trusted: async (operation) =>
      database.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE huayi_context_setter");
        return operation({
          rows: async <Row>(sql: string, parameters: readonly unknown[] = []) =>
            (await tx.query<Row>(sql, [...parameters])).rows,
        });
      }),
  };
}
async function profile() {
  await db.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'backfill@example.test','active','UTC',5)",
    [owner],
  );
}
async function words(count: number) {
  for (let index = 0; index < count; index += 1) {
    const word = `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`;
    await db.query(
      "INSERT INTO word_entries(id,owner_user_id,headword,canonical_key,revision,created_at,updated_at) VALUES($1,$2,$3,$3,1,now(),now())",
      [crypto.randomUUID(), owner, word],
    );
  }
}
function jobs(database: AnalysisDatabase) {
  return createExternalWordbookModule({
    repository: createPostgresExternalWordbook(database, true),
    now: () => new Date(),
    ids: () => crypto.randomUUID(),
    leaseDurationMs: 300_000,
    leaseKey: new Uint8Array(32).fill(8),
    cursorKey: new Uint8Array(32).fill(4),
  });
}
afterEach(async () => {
  vi.useRealTimers();
  await db.close();
});
describe("Shared Shanbay compatibility and export", () => {
  beforeEach(async () => {
    db = await createCurrentDatabaseFixture();
    await profile();
  });
  it("rejects oversized batches before persistence", async () => {
    const database = adapter(db);
    await createPostgresShanbayBackfill(database).status(owner);
    const before = createBackfillState();
    const state = createBackfillState();
    state.batches.push({
      token: "oversized",
      holder: "device-one",
      headwords: Array.from(
        { length: 101 },
        (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
      ),
      state: "prepared",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    await expect(
      database.transaction(owner, ({ tenant }) => saveBackfillState(tenant, owner, before, state)),
    ).rejects.toThrow();
    expect((await db.query("SELECT record FROM shanbay_backfill_batches")).rows).toEqual([]);
  });
  it.each(["legacy", "backfill"])(
    "keeps 120 targets exclusive with legacy 20-word and new 100-word leases when %s claims first",
    async (first) => {
      await words(120);
      const database = adapter(db);
      const old = jobs(database);
      const ledger = createPostgresShanbayBackfill(database);
      const job = await old.create(owner, "create", { direction: "export", target: "shanbay" });
      await ledger.execute(owner, "device-new", "enable", {
        action: "settings",
        enabled: true,
        dailyHour: 8,
        expectedRevision: 0,
      });
      const claimOld = () =>
        old.lease(owner, job.id, { claimNonce: "n".repeat(43), expectedRevision: job.revision });
      const claimNew = () =>
        ledger.execute(owner, "device-new", "claim", { action: "claim", limit: 100 });
      const [legacy, response] =
        first === "legacy"
          ? [await claimOld(), await claimNew()]
          : await (async () => {
              const response = await claimNew();
              return [await claimOld(), response] as const;
            })();
      if (legacy.kind !== "export" || !response.batch)
        throw new Error("Expected both bounded leases.");
      expect(
        new Set([...legacy.entries.map((entry) => entry.headword), ...response.batch.headwords])
          .size,
      ).toBe(120);
      expect(legacy.entries).toHaveLength(20);
      expect(response.batch.headwords).toHaveLength(100);
      await old.submit(owner, job.id, "old-receipt", {
        kind: "export",
        leaseToken: legacy.leaseToken,
        receipts: legacy.entries.map((entry) => ({ itemId: entry.itemId, outcome: "confirmed" })),
      });
      await ledger.execute(owner, "device-new", "new-receipt", {
        action: "resolve",
        token: response.batch.token,
        confirmed: response.batch.headwords,
        rejected: [],
      });
      expect(await ledger.status(owner)).toMatchObject({ pendingCount: 0, unknownCount: 0 });
      expect(await old.get(owner, job.id)).toMatchObject({
        state: "completed",
        processedCount: 120,
      });
    },
  );
  it("does not automatically replace an expired legacy Shanbay lease", async () => {
    await words(1);
    const database = adapter(db);
    const old = jobs(database);
    const ledger = createPostgresShanbayBackfill(database);
    const job = await old.create(owner, "create", { direction: "export", target: "shanbay" });
    const lease = await old.lease(owner, job.id, {
      claimNonce: "n".repeat(43),
      expectedRevision: job.revision,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(lease.expiresAt) + 1_000));
    await expect(
      old.lease(owner, job.id, { claimNonce: "r".repeat(43), expectedRevision: job.revision + 1 }),
    ).rejects.toMatchObject({ code: "wordbook_job_not_claimable" });
    expect(await ledger.status(owner)).toMatchObject({ unknownCount: 1 });
  });
  it("exports ledger history only in format 5 without device holders or lease tokens", async () => {
    const database = adapter(db);
    const ledger = createPostgresShanbayBackfill(database);
    await ledger.execute(owner, "secret-holder", "enable", {
      action: "settings",
      enabled: true,
      dailyHour: 8,
      expectedRevision: 0,
    });
    await ledger.execute(owner, "secret-holder", "discover", {
      action: "discover",
      origin: "eudic",
      headwords: ["apple"],
    });
    const claim = await ledger.execute(owner, "secret-holder", "claim", { action: "claim" });
    if (!claim.batch) throw new Error("Expected batch.");
    await ledger.execute(owner, "secret-holder", "receipt", {
      action: "resolve",
      token: claim.batch.token,
      confirmed: ["apple"],
      rejected: [],
    });
    const source = createPostgresAccountDataExportSource(database);
    const records = await source.records(owner, new Date().toISOString(), 5);
    expect(records.map((record) => record.recordType)).toEqual(
      expect.arrayContaining([
        "shanbay-backfill-settings",
        "shanbay-backfill-source",
        "shanbay-backfill-target",
        "shanbay-backfill-batch",
      ]),
    );
    expect(JSON.stringify(records)).not.toContain("secret-holder");
    expect(JSON.stringify(records)).not.toContain(claim.batch.token);
    expect(
      (await source.records(owner, new Date().toISOString(), 4)).some((record) =>
        record.recordType.startsWith("shanbay-backfill"),
      ),
    ).toBe(false);
  });
  it("mirrors migrations and keeps format 5 away from older workers and public roles", async () => {
    for (const [local, remote] of [
      ["0039-shanbay-backfill.sql", "20260915080000_shanbay_backfill.sql"],
      ["0040-backfill-account-exports.sql", "20260915080100_backfill_account_exports.sql"],
    ])
      expect(await readFile(new URL(`../migrations/${local}`, import.meta.url), "utf8")).toBe(
        await readFile(new URL(`../../../supabase/migrations/${remote}`, import.meta.url), "utf8"),
      );
    await db.query(
      "INSERT INTO account_data_export_jobs(id,owner_user_id,state,format_version) VALUES($1,$2,'pending',5)",
      [crypto.randomUUID(), owner],
    );
    expect(
      (await db.query("SELECT * FROM claim_account_export_v4('old',now()+interval '2 minutes')"))
        .rows,
    ).toEqual([]);
    expect(
      (await db.query("SELECT * FROM claim_account_export_v5('new',now()+interval '2 minutes')"))
        .rows,
    ).toHaveLength(1);
    for (const role of ["anon", "authenticated", "service_role", "huayi_business"]) {
      for (const name of [
        "claim_account_export_v5(text,timestamptz)",
        "authenticate_backfill_extension(text)",
        "begin_backfill_write(uuid,text,text)",
      ])
        expect(
          (await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, name]))
            .rows,
        ).toEqual([{ allowed: false }]);
    }
  });
});
it("migrates only explicit Shanbay confirmations, not completed jobs, Eudic or unknown receipts", async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;");
  await db.exec(
    await readFile(new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url), "utf8"),
  );
  await profile();
  for (const [word, target, receipt] of [
    ["apple", "shanbay", { outcome: "confirmed", target: "shanbay" }],
    ["bird", "shanbay", null],
    ["cat", "eudic", { outcome: "created", target: "eudic" }],
    ["dog", "shanbay", { outcome: "unknown", target: "shanbay" }],
  ] as const) {
    const wordId = crypto.randomUUID(),
      jobId = crypto.randomUUID();
    await db.query(
      "INSERT INTO word_entries(id,owner_user_id,headword,canonical_key,revision,created_at,updated_at) VALUES($1,$2,$3,$3,1,now(),now())",
      [wordId, owner, word],
    );
    await db.query(
      "INSERT INTO external_wordbook_jobs(id,owner_user_id,target,direction,state) VALUES($1,$2,$3,'export','completed')",
      [jobId, owner, target],
    );
    await db.query(
      "INSERT INTO external_wordbook_items(id,owner_user_id,job_id,word_entry_id,payload_snapshot,state,receipt,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,'delivered',$6::jsonb,now(),now())",
      [
        crypto.randomUUID(),
        owner,
        jobId,
        wordId,
        JSON.stringify({ headword: word }),
        JSON.stringify(receipt),
      ],
    );
  }
  await db.exec(
    await readFile(new URL("../migrations/0039-shanbay-backfill.sql", import.meta.url), "utf8"),
  );
  expect((await db.query("SELECT headword FROM shanbay_backfill_targets")).rows).toEqual([
    { headword: "apple" },
  ]);
});

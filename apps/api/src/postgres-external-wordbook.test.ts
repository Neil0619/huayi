import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createExternalWordbookModule } from "./external-wordbook-module.js";
import { createPostgresExternalWordbook } from "./postgres-external-wordbook.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const ownerA = "00000000-0000-0000-0000-00000000000a";
const ownerB = "00000000-0000-0000-0000-00000000000b";
const wordA = "70000000-0000-0000-0000-00000000000a";
const wordB = "70000000-0000-0000-0000-00000000000b";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres external wordbook jobs", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  let now: Date;
  let nextId: number;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    adapter = {
      async transaction(ownerUserId, operation) {
        return database.transaction(async (transaction) => {
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          await transaction.query("SELECT huayi_private.set_owner_context($1)", [ownerUserId]);
          return operation({
            tenant: {
              rows: async (text, parameters) => {
                await transaction.exec("SET LOCAL ROLE huayi_business");
                return query(transaction).rows(text, parameters);
              },
            },
            trusted: query(transaction),
          });
        });
      },
      async trusted(operation) {
        return operation(query(database));
      },
    };
    now = new Date("2026-08-13T08:00:00.000Z");
    nextId = 1;
    await database.exec(`INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${ownerA}','${ownerA}','a@example.test','active','UTC',5),
        ('${ownerB}','${ownerB}','b@example.test','active','UTC',5);
      INSERT INTO word_entries(id,owner_user_id,headword,canonical_key,notes,revision,created_at,updated_at)
      VALUES('${wordA}','${ownerA}','Accountable','accountable','keep me',1,
      '2026-08-13T03:00:00Z','2026-08-13T03:00:00Z'),
      ('${wordB}','${ownerA}','Preserve','preserve',NULL,1,
      '2026-08-13T02:00:00Z','2026-08-13T02:00:00Z');
      INSERT INTO context_observations(
        id,owner_user_id,word_entry_id,content_hash,source_text,source_type,observed_at
      ) VALUES('71000000-0000-0000-0000-00000000000a','${ownerA}','${wordA}','a','Older.',
      'manual','2026-08-13T04:00:00Z'),('71000000-0000-0000-0000-00000000000b','${ownerA}',
      '${wordA}','b','Latest sentence.','web-selection','2026-08-13T05:00:00Z');`);
  });

  afterEach(async () => database.close());

  function module() {
    return createExternalWordbookModule({
      cursorKey: new Uint8Array(32).fill(4),
      ids: () => `80000000-0000-0000-0000-${String(nextId++).padStart(12, "0")}`,
      leaseDurationMs: 5 * 60 * 1_000,
      leaseKey: new Uint8Array(32).fill(8),
      now: () => now,
      repository: createPostgresExternalWordbook(adapter),
    });
  }

  it("snapshots one open export, replays its nonce, and fences an expired worker", async () => {
    const jobs = module();
    const created = await jobs.create(ownerA, "create-export", {
      direction: "export",
      target: "eudic",
    });
    expect(created).toMatchObject({ state: "pending", totalCount: 2 });
    await expect(
      jobs.create(ownerA, "create-export", { direction: "export", target: "eudic" }),
    ).resolves.toEqual(created);
    await expect(
      jobs.create(ownerA, "another-create", { direction: "export", target: "eudic" }),
    ).resolves.toMatchObject({ id: created.id, totalCount: 2 });
    await expect(jobs.get(ownerB, created.id)).resolves.toBeNull();

    const first = await jobs.lease(ownerA, created.id, {
      claimNonce: "a".repeat(43),
      expectedRevision: 1,
    });
    expect(first).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          contextLine: "Latest sentence.",
          headword: "Accountable",
        }),
        expect.objectContaining({ headword: "Preserve" }),
      ]),
      kind: "export",
    });
    await expect(
      jobs.lease(ownerA, created.id, {
        claimNonce: "a".repeat(43),
        expectedRevision: 1,
      }),
    ).resolves.toEqual(first);
    await expect(
      jobs.lease(ownerA, created.id, {
        claimNonce: "b".repeat(43),
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "wordbook_job_leased" });

    now = new Date("2026-08-13T08:06:00.000Z");
    const replacement = await jobs.lease(ownerA, created.id, {
      claimNonce: "b".repeat(43),
      expectedRevision: 2,
    });
    if (first.kind !== "export" || replacement.kind !== "export") {
      throw new Error("Expected export leases.");
    }
    await expect(
      jobs.submit(ownerA, created.id, "stale-receipt", {
        kind: "export",
        leaseToken: first.leaseToken,
        receipts: first.entries.map((entry) => ({ itemId: entry.itemId, outcome: "created" })),
      }),
    ).rejects.toMatchObject({ code: "wordbook_lease_stale" });
    const completed = await jobs.submit(ownerA, created.id, "fresh-receipt", {
      kind: "export",
      leaseToken: replacement.leaseToken,
      receipts: replacement.entries.map((entry) => ({
        itemId: entry.itemId,
        outcome: "created" as const,
      })),
    });
    expect(completed).toMatchObject({ processedCount: 2, state: "completed" });
    await expect(
      jobs.submit(ownerA, created.id, "fresh-receipt", {
        kind: "export",
        leaseToken: replacement.leaseToken,
        receipts: replacement.entries.map((entry) => ({
          itemId: entry.itemId,
          outcome: "created" as const,
        })),
      }),
    ).resolves.toEqual(completed);
  });

  it("keeps failed export items retryable and accepts a cancelled job's current late receipt", async () => {
    const jobs = module();
    const created = await jobs.create(ownerA, "create-shanbay", {
      direction: "export",
      target: "shanbay",
    });
    const lease = await jobs.lease(ownerA, created.id, {
      claimNonce: "s".repeat(43),
      expectedRevision: 1,
    });
    if (lease.kind !== "export") throw new Error("Expected export lease.");
    const failed = await jobs.submit(ownerA, created.id, "partial", {
      kind: "export",
      leaseToken: lease.leaseToken,
      receipts: lease.entries.map((entry, index) =>
        index === 0
          ? { itemId: entry.itemId, outcome: "confirmed" as const }
          : {
              itemId: entry.itemId,
              outcome: "failed" as const,
              stableErrorCode: "invalid-response" as const,
            },
      ),
    });
    expect(failed).toMatchObject({ failedCount: 1, processedCount: 1, state: "failed" });
    const retried = await jobs.retry(ownerA, created.id, "retry-1", {
      expectedRevision: failed.revision,
    });
    expect(retried).toMatchObject({ failedCount: 0, state: "pending" });
    const retryLease = await jobs.lease(ownerA, created.id, {
      claimNonce: "r".repeat(43),
      expectedRevision: retried.revision,
    });
    if (retryLease.kind !== "export") throw new Error("Expected retry lease.");
    const cancelled = await jobs.cancel(ownerA, created.id, "cancel-1", {
      expectedRevision: retried.revision + 1,
    });
    expect(cancelled.state).toBe("cancelled");
    await expect(
      jobs.submit(ownerA, created.id, "late-confirmation", {
        kind: "export",
        leaseToken: retryLease.leaseToken,
        receipts: retryLease.entries.map((entry) => ({
          itemId: entry.itemId,
          outcome: "confirmed" as const,
        })),
      }),
    ).resolves.toMatchObject({ processedCount: 2, state: "cancelled" });
  });

  it("atomically imports Eudic pages without overwriting notes and discards a cancelled late page", async () => {
    const jobs = module();
    const created = await jobs.create(ownerA, "create-import", {
      direction: "import",
      target: "eudic",
    });
    const lease = await jobs.lease(ownerA, created.id, {
      claimNonce: "i".repeat(43),
      expectedRevision: 1,
    });
    if (lease.kind !== "eudic-import") throw new Error("Expected import lease.");
    const completed = await jobs.submit(ownerA, created.id, "page-0", {
      entries: [
        {
          addedAt: "2026-08-12T03:00:00.000Z",
          contextLine: "Imported context.",
          headword: "ACCOUNTABLE",
        },
        { addedAt: "2026-08-12T04:00:00.000Z", headword: "Make do" },
      ],
      kind: "eudic-import-page",
      leaseToken: lease.leaseToken,
      page: 0,
    });
    expect(completed).toMatchObject({ nextPage: 1, processedCount: 2, state: "completed" });
    const imported = await database.query<{
      contexts: number;
      has_eudic: boolean;
      notes: string;
      revision: number;
    }>(
      `SELECT w.notes,w.revision,count(c.id)::int contexts,
         bool_or(c.source_type='eudic') has_eudic
       FROM word_entries w LEFT JOIN context_observations c ON c.word_entry_id=w.id
       WHERE w.id=$1 GROUP BY w.id`,
      [wordA],
    );
    expect(imported.rows[0]).toEqual({
      contexts: 3,
      has_eudic: true,
      notes: "keep me",
      revision: 2,
    });

    const cancelledJob = await jobs.create(ownerA, "create-import-cancel", {
      direction: "import",
      target: "eudic",
    });
    const cancelledLease = await jobs.lease(ownerA, cancelledJob.id, {
      claimNonce: "c".repeat(43),
      expectedRevision: 1,
    });
    if (cancelledLease.kind !== "eudic-import") throw new Error("Expected import lease.");
    await jobs.cancel(ownerA, cancelledJob.id, "cancel-import", { expectedRevision: 2 });
    await expect(
      jobs.submit(ownerA, cancelledJob.id, "late-page", {
        entries: [{ addedAt: "2026-08-12T05:00:00.000Z", headword: "Must not appear" }],
        kind: "eudic-import-page",
        leaseToken: cancelledLease.leaseToken,
        page: 0,
      }),
    ).resolves.toMatchObject({ processedCount: 0, state: "cancelled" });
    const absent = await database.query<{ count: number }>(
      "SELECT count(*)::int count FROM word_entries WHERE canonical_key='must not appear'",
    );
    expect(absent.rows[0]?.count).toBe(0);
  });
});

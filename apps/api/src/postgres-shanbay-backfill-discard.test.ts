import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackfillState, ShanbayBackfillCommand } from "@huayi/cloud-contracts";
import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresShanbayBackfill } from "./postgres-shanbay-backfill.js";

const ownerA = "00000000-0000-0000-0000-00000000000a";
const ownerB = "00000000-0000-0000-0000-00000000000b";
const words = Array.from(
  { length: 150 },
  (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
).concat("walking");
const source = (
  headword: string,
  state: BackfillState["sources"][string]["state"] = "unresolved",
): BackfillState["sources"][string] => ({
  headword,
  target: headword === "walking" ? "walk" : headword,
  origins: ["local"],
  attempt: headword === "walking" ? "lemma" : "original",
  state,
  updatedAt: "2026-09-15T08:00:00.000Z",
});

describe("Postgres bulk unresolved discard", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  let ledger: ReturnType<typeof createPostgresShanbayBackfill>;
  let nonce: number;
  let transactions: number;
  let statements: string[];
  let failSourceWriteAt: number | null;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    for (const file of ["0001-cloud-v1-foundation.sql", "0039-shanbay-backfill.sql"])
      await database.exec(
        await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
      );
    statements = [];
    transactions = 0;
    nonce = 0;
    failSourceWriteAt = null;
    adapter = {
      transaction: (owner, operation) => {
        transactions += 1;
        return database.transaction(async (transaction) => {
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          await transaction.query("SELECT huayi_private.set_owner_context($1)", [owner]);
          let sourceWrites = 0;
          const roleQuery = (role: "huayi_business" | "huayi_context_setter"): AnalysisQuery => ({
            rows: async <Row>(text: string, parameters: readonly unknown[] = []) => {
              statements.push(text);
              if (text.startsWith("INSERT INTO shanbay_backfill_sources")) {
                sourceWrites += 1;
                if (sourceWrites === failSourceWriteAt)
                  throw new Error("Injected source write failure.");
              }
              await transaction.exec(`SET LOCAL ROLE ${role}`);
              return (await transaction.query<Row>(text, [...parameters])).rows;
            },
          });
          return operation({
            tenant: roleQuery("huayi_business"),
            trusted: roleQuery("huayi_context_setter"),
          });
        });
      },
      trusted: async () => {
        throw new Error("Bulk discard must use the account transaction.");
      },
    };
    for (const owner of [ownerA, ownerB])
      await database.query(
        `INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
         VALUES($1,$1,$2,'active','UTC',5)`,
        [owner, `${owner}@example.test`],
      );
    ledger = createPostgresShanbayBackfill(adapter);
    for (const owner of [ownerA, ownerB])
      await execute(
        { action: "settings", enabled: true, dailyHour: 8, expectedRevision: 0 },
        owner,
      );
  });

  afterEach(async () => {
    await database.close();
  });

  function execute(command: ShanbayBackfillCommand, owner = ownerA, key = `write-${nonce++}`) {
    return ledger.execute(owner, "device-one", key, command);
  }
  async function seedUnresolved() {
    for (let index = 0; index < words.length; index += 100)
      await execute({
        action: "adopt",
        sources: words.slice(index, index + 100).map((word) => source(word)),
        confirmed: [],
      });
  }
  async function snapshot(owner = ownerA) {
    const result: Record<string, unknown[]> = {};
    for (const name of ["accounts", "sources", "targets", "batches"])
      result[name] = (
        await database.query(
          `SELECT * FROM shanbay_backfill_${name} WHERE owner_user_id=$1 ORDER BY 1,2`,
          [owner],
        )
      ).rows;
    result.receipts = (
      await database.query(
        "SELECT * FROM idempotency_records WHERE owner_user_id=$1 ORDER BY key",
        [owner],
      )
    ).rows;
    return result;
  }

  it("atomically discards beyond the review page with bounded writes and exact idempotency replay", async () => {
    await execute({ action: "discover", origin: "local", headwords: ["confirmed"] });
    const oldClaim = await execute({ action: "claim" });
    if (!oldClaim.batch) throw new Error("Expected a confirmation batch.");
    const oldReceiptCommand = {
      action: "resolve" as const,
      token: oldClaim.batch.token,
      confirmed: ["confirmed"],
      rejected: [],
    };
    const oldReceipt = await execute(oldReceiptCommand, ownerA, "old-receipt");
    await execute({
      action: "adopt",
      sources: [source("unknown", "pending")],
      confirmed: [],
      unknown: ["unknown"],
    });
    await seedUnresolved();
    await execute({
      action: "adopt",
      sources: [source("pending", "pending"), source("discarded", "discarded")],
      confirmed: [],
    });
    await execute({ action: "adopt", sources: [source("private")], confirmed: [] }, ownerB);
    const review = await ledger.unresolved(ownerA);
    expect(review.items.length).toBeLessThanOrEqual(100);
    expect(review.nextCursor).not.toBeNull();
    expect((await ledger.status(ownerA)).unresolvedCount).toBe(151);
    const before = await snapshot();
    const otherBefore = await snapshot(ownerB);
    const command = { action: "discard-unresolved" as const, expectedRevision: review.revision };

    await expect(
      execute({ ...command, expectedRevision: review.revision - 1 }, ownerA, "stale"),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(await snapshot()).toEqual(before);
    transactions = 0;
    statements = [];
    const response = await execute(command, ownerA, "discard-all");
    expect(response).toMatchObject({
      accepted: true,
      batch: null,
      nextCursor: null,
      status: {
        pendingCount: 1,
        unresolvedCount: 0,
        unknownCount: 1,
        revision: review.revision + 1,
      },
    });
    expect(transactions).toBe(1);
    expect(
      statements.filter((text) => text.startsWith("INSERT INTO shanbay_backfill_sources")),
    ).toHaveLength(2);
    expect(
      statements.filter((text) => /INSERT INTO shanbay_backfill_(targets|batches)/u.test(text)),
    ).toEqual([]);
    const records = (
      await database.query<{ headword: string; record: unknown }>(
        "SELECT headword,record FROM shanbay_backfill_sources WHERE owner_user_id=$1",
        [ownerA],
      )
    ).rows;
    for (const word of words)
      expect(records.find((row) => row.headword === word)?.record).toEqual({
        ...source(word),
        state: "discarded",
        updatedAt: expect.any(String),
      });
    const after = await snapshot();
    expect(after.targets).toEqual(before.targets);
    expect(after.batches).toEqual(before.batches);
    expect(
      after.sources?.filter((row) => !words.includes((row as { headword: string }).headword)),
    ).toEqual(
      before.sources?.filter((row) => !words.includes((row as { headword: string }).headword)),
    );
    expect(await snapshot(ownerB)).toEqual(otherBefore);

    for (let index = 0; index < words.length; index += 100)
      await execute({
        action: "discover",
        origin: "eudic",
        headwords: words.slice(index, index + 100),
      });
    ledger = createPostgresShanbayBackfill(adapter);
    const current = await snapshot();
    statements = [];
    await expect(execute(command, ownerA, "discard-all")).resolves.toEqual(response);
    await expect(execute(oldReceiptCommand, ownerA, "old-receipt")).resolves.toEqual(oldReceipt);
    expect(await snapshot()).toEqual(current);
    expect(statements.filter((text) => text.startsWith("INSERT"))).toEqual([]);
    await expect(
      execute({ ...command, expectedRevision: response.status.revision }, ownerA, "discard-all"),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect((await ledger.status(ownerA)).unresolvedCount).toBe(0);
    expect((await ledger.unresolved(ownerA)).items).toEqual([]);
  });

  it("retains an unresolved source held by an unknown batch while discarding every free source", async () => {
    const seeded = await execute({
      action: "adopt",
      sources: [source("held"), source("free")],
      confirmed: [],
      unknown: ["held"],
    });
    const before = await snapshot();
    const response = await execute({
      action: "discard-unresolved",
      expectedRevision: seeded.status.revision,
    });
    expect(response.status).toMatchObject({ unresolvedCount: 1, unknownCount: 1 });
    const review = await ledger.unresolved(ownerA);
    expect(review.items.map((item) => item.headword)).toEqual(["held"]);
    expect(review.unknownBatches).toEqual([{ token: expect.any(String), headwords: ["held"] }]);
    expect((await snapshot()).batches).toEqual(before.batches);
  });

  it("rolls back all source chunks and the revision on a failed write, allowing the same key to retry", async () => {
    await seedUnresolved();
    const revision = (await ledger.status(ownerA)).revision;
    const command = { action: "discard-unresolved" as const, expectedRevision: revision };
    const before = await snapshot();
    failSourceWriteAt = 2;
    await expect(execute(command, ownerA, "retry-after-rollback")).rejects.toThrow(
      "Injected source write failure.",
    );
    expect(await snapshot()).toEqual(before);
    failSourceWriteAt = null;
    await expect(execute(command, ownerA, "retry-after-rollback")).resolves.toMatchObject({
      accepted: true,
      status: { unresolvedCount: 0, revision: revision + 1 },
    });
  });
});

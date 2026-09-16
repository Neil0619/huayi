import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import {
  shanbayBackfillCommandSchema,
  type ShanbayBackfillCommand,
  type ShanbayBackfillResponse,
} from "@huayi/cloud-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresShanbayBackfill } from "./postgres-shanbay-backfill.js";

const ownerA = "00000000-0000-0000-0000-00000000000a";
const ownerB = "00000000-0000-0000-0000-00000000000b";
const holderA = "device-one";
const tables = ["accounts", "sources", "targets", "batches"].map(
  (name) => `shanbay_backfill_${name}`,
);
const source = (headword: string, state: "pending" | "unresolved" = "pending") => ({
  headword,
  target: headword,
  origins: ["local" as const],
  attempt: "original" as const,
  state,
  updatedAt: "2026-09-15T08:00:00.000Z",
});

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

function batch(response: ShanbayBackfillResponse) {
  expect(response.accepted).toBe(true);
  if (response.batch === null) throw new Error("Expected a backfill lease.");
  return response.batch;
}

describe("Postgres Shanbay backfill ledger", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  let ledger: ReturnType<typeof createPostgresShanbayBackfill>;
  let nonce: number;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    for (const file of ["0001-cloud-v1-foundation.sql", "0039-shanbay-backfill.sql"]) {
      await database.exec(
        await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
      );
    }
    adapter = {
      transaction: (owner, operation) =>
        database.transaction(async (transaction) => {
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          await transaction.query("SELECT huayi_private.set_owner_context($1)", [owner]);
          const roleQuery = (role: "huayi_business" | "huayi_context_setter"): AnalysisQuery => ({
            rows: async (text, parameters) => {
              await transaction.exec(`SET LOCAL ROLE ${role}`);
              return query(transaction).rows(text, parameters);
            },
          });
          return operation({
            tenant: roleQuery("huayi_business"),
            trusted: roleQuery("huayi_context_setter"),
          });
        }),
      trusted: (operation) =>
        database.transaction(async (transaction) => {
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          return operation(query(transaction));
        }),
    };
    for (const owner of [ownerA, ownerB]) {
      await database.query(
        `INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
         VALUES($1,$1,$2,'active','UTC',5)`,
        [owner, `${owner}@example.test`],
      );
    }
    ledger = createPostgresShanbayBackfill(adapter);
    nonce = 0;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await database.close();
  });

  function execute(
    command: ShanbayBackfillCommand,
    key = `write-${nonce++}`,
    owner = ownerA,
    holder = holderA,
  ) {
    return ledger.execute(owner, holder, key, shanbayBackfillCommandSchema.parse(command));
  }

  const enable = (owner = ownerA) =>
    execute(
      { action: "settings", enabled: true, dailyHour: 8, expectedRevision: 0 },
      "enable",
      owner,
    );
  const discover = (headwords: string[]) =>
    execute({ action: "discover", origin: "eudic", headwords });
  const confirm = (lease: NonNullable<ShanbayBackfillResponse["batch"]>, key?: string) =>
    execute(
      { action: "resolve", token: lease.token, confirmed: lease.headwords, rejected: [] },
      key,
    );
  const insertWord = (headword: string, owner = ownerA) =>
    database.query(
      `INSERT INTO word_entries(id,owner_user_id,headword,canonical_key,notes)
     VALUES(gen_random_uuid(),$1,$2,$3,'keep this note') RETURNING id`,
      [owner, headword, headword.toLowerCase()],
    );

  it("defaults to disabled with stable, separate account scopes and requires explicit enablement", async () => {
    const initial = await ledger.status(ownerA);
    expect(initial).toMatchObject({
      enabled: false,
      revision: 0,
      pendingCount: 0,
      unresolvedCount: 0,
      unknownCount: 0,
      lastCheckedAt: null,
    });
    expect((await ledger.status(ownerA)).scopeId).toBe(initial.scopeId);
    expect((await ledger.status(ownerB)).scopeId).not.toBe(initial.scopeId);
    for (const command of [
      { action: "discover", origin: "eudic", headwords: ["apple"] },
      { action: "reconcile", cursor: null },
      { action: "claim" },
      { action: "adopt", sources: [source("apple")], confirmed: [] },
    ] satisfies ShanbayBackfillCommand[]) {
      await expect(execute(command)).rejects.toMatchObject({ code: "forbidden" });
    }
    expect((await enable()).status).toMatchObject({ enabled: true, dailyHour: 8, revision: 1 });
    await expect(ledger.status(ownerB)).resolves.toMatchObject({ enabled: false, pendingCount: 0 });
  });

  it.each([undefined, 100])(
    "claims 20+1 or 100+1 targets and preserves old hashes and receipts for limit %s",
    async (limit) => {
      const command =
        limit === undefined ? { action: "claim" as const } : { action: "claim" as const, limit };
      const size = limit ?? 20;
      await enable();
      const words = Array.from(
        { length: size + 1 },
        (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
      );
      await discover(words.slice(0, 100));
      if (words.length > 100) await discover(words.slice(100));
      expect((await ledger.status(ownerA)).pendingCount).toBe(size + 1);
      const claimed = await execute(command, "old-claim");
      const first = batch(claimed);
      expect(first.headwords).toHaveLength(size);
      const hash = createHash("sha256")
        .update(JSON.stringify({ holder: holderA, command }))
        .digest("hex");
      const stored = await database.query(
        "SELECT request_hash FROM idempotency_records WHERE key='old-claim'",
      );
      expect(stored.rows).toEqual([{ request_hash: hash }]);
      ledger = createPostgresShanbayBackfill(adapter);
      await expect(execute(command, "old-claim")).resolves.toEqual(claimed);
      await expect(
        execute({ action: "claim", limit: limit === undefined ? 100 : 20 }, "old-claim"),
      ).rejects.toMatchObject({
        code: "idempotency_conflict",
      });
      await expect(execute({ action: "renew", token: first.token })).resolves.toMatchObject({
        accepted: true,
        batch: { token: first.token, headwords: first.headwords },
      });
      const receipt = await confirm(first, "old-receipt");
      await expect(confirm(first, "old-receipt")).resolves.toEqual(receipt);
      const second = batch(await execute(command));
      expect(second.headwords).toHaveLength(1);
      expect([...first.headwords, ...second.headwords].sort()).toEqual([...words].sort());
      await confirm(second);
      await discover(words.slice(0, 100));
      await expect(execute(command)).resolves.toMatchObject({
        batch: null,
        status: { pendingCount: 0, unresolvedCount: 0, unknownCount: 0 },
      });
    },
  );

  it("deduplicates all three canonical sources without creating or overwriting cloud WordEntries", async () => {
    await enable();
    await insertWord("APPLE");
    await insertWord("private", ownerB);
    const before = (await database.query("SELECT * FROM word_entries ORDER BY id")).rows;
    await discover(["Apple", "apple", "PEAR"]);
    await execute({ action: "discover", origin: "local", headwords: ["APPLE"] });
    await expect(execute({ action: "reconcile", cursor: null })).resolves.toMatchObject({
      nextCursor: null,
      status: { pendingCount: 2, lastCheckedAt: expect.any(String) },
    });
    const records = await database.query<{ headword: string; origins: string[] }>(
      `SELECT headword,record->'origins' origins FROM shanbay_backfill_sources
       WHERE owner_user_id=$1 ORDER BY headword`,
      [ownerA],
    );
    expect(records.rows).toEqual([
      { headword: "apple", origins: expect.arrayContaining(["eudic", "local", "cloud"]) },
      { headword: "pear", origins: ["eudic"] },
    ]);
    expect(batch(await execute({ action: "claim" })).headwords.sort()).toEqual(["apple", "pear"]);
    expect((await database.query("SELECT * FROM word_entries ORDER BY id")).rows).toEqual(before);
  });

  it("fences other holders and owners from renewal, settlement, and an already leased target", async () => {
    await enable();
    await enable(ownerB);
    await discover(["garden"]);
    const lease = batch(await execute({ action: "claim" }, "claim"));
    await expect(execute({ action: "claim" }, "claim", ownerA, "device-two")).rejects.toMatchObject(
      {
        code: "idempotency_conflict",
      },
    );
    for (const command of [
      { action: "renew", token: lease.token },
      { action: "resolve", token: lease.token, confirmed: ["garden"], rejected: [] },
      { action: "unknown", token: lease.token },
    ] satisfies ShanbayBackfillCommand[]) {
      await expect(execute(command, undefined, ownerA, "device-two")).resolves.toMatchObject({
        accepted: false,
      });
      await expect(execute(command, undefined, ownerB)).resolves.toMatchObject({ accepted: false });
    }
    await expect(
      execute({ action: "claim" }, "other-claim", ownerA, "device-two"),
    ).resolves.toMatchObject({ batch: null });
    await expect(execute({ action: "renew", token: lease.token })).resolves.toMatchObject({
      accepted: true,
    });
    await expect(confirm(lease)).resolves.toMatchObject({
      accepted: true,
      status: { pendingCount: 0 },
    });
    expect((await ledger.status(ownerB)).pendingCount).toBe(0);
  });

  it("replays claims and receipts exactly and rejects changed requests or stale revisions", async () => {
    await enable();
    await discover(["river"]);
    const claimed = await execute({ action: "claim" }, "same-claim");
    await expect(execute({ action: "claim" }, "same-claim")).resolves.toEqual(claimed);
    const lease = batch(claimed);
    const settled = await confirm(lease, "same-receipt");
    await expect(confirm(lease, "same-receipt")).resolves.toEqual(settled);
    await expect(
      execute(
        { action: "resolve", token: lease.token, confirmed: [], rejected: ["river"] },
        "same-receipt",
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(
      execute({ action: "settings", enabled: false, dailyHour: 12, expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(await ledger.status(ownerA)).toEqual(settled.status);
  });

  it("keeps unknown work blocked across reload until an explicit retry and fences the old token", async () => {
    await enable();
    await discover(["cloud"]);
    const first = batch(await execute({ action: "claim" }));
    await expect(execute({ action: "unknown", token: first.token })).resolves.toMatchObject({
      accepted: true,
      status: { unknownCount: 1, pendingCount: 0 },
    });
    ledger = createPostgresShanbayBackfill(adapter);
    await expect(ledger.unresolved(ownerA)).resolves.toMatchObject({
      items: [],
      unknownBatches: [{ token: first.token, headwords: ["cloud"] }],
      nextCursor: null,
    });
    await expect(execute({ action: "claim" })).resolves.toMatchObject({ batch: null });
    await execute({ action: "retry-unknown", token: first.token });
    const retried = batch(await execute({ action: "claim" }));
    expect(retried.headwords).toEqual(["cloud"]);
    expect(retried.token).not.toBe(first.token);
    await expect(confirm(first)).resolves.toMatchObject({ accepted: false });
    await expect(confirm(retried)).resolves.toMatchObject({
      accepted: true,
      status: { unknownCount: 0 },
    });
  });

  it("turns expiry into unknown instead of silently reissuing the batch", async () => {
    await enable();
    await discover(["stone"]);
    const lease = batch(await execute({ action: "claim" }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(lease.expiresAt) + 1));
    await expect(execute({ action: "claim" })).resolves.toMatchObject({
      batch: null,
      status: { pendingCount: 0, unknownCount: 1 },
    });
    await expect(confirm(lease)).resolves.toMatchObject({ accepted: false });
  });

  it("preserves adoption, unresolved replacements, and discards across rediscovery", async () => {
    await enable();
    await execute({
      action: "adopt",
      sources: [source("apple"), source("quux"), source("zzyzx")],
      confirmed: ["apple"],
    });
    const lease = batch(await execute({ action: "claim" }));
    expect(lease.headwords.sort()).toEqual(["quux", "zzyzx"]);
    const rejected = await execute({
      action: "resolve",
      token: lease.token,
      confirmed: [],
      rejected: lease.headwords,
    });
    expect(rejected.status.unresolvedCount).toBe(2);
    const unresolved = await ledger.unresolved(ownerA);
    expect(unresolved.items.map((item) => item.headword).sort()).toEqual(["quux", "zzyzx"]);
    const replaced = await execute({
      action: "replace",
      source: "quux",
      target: "apple",
      expectedRevision: unresolved.revision,
    });
    await expect(
      execute({ action: "discard", source: "zzyzx", expectedRevision: unresolved.revision }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    await execute({
      action: "discard",
      source: "zzyzx",
      expectedRevision: replaced.status.revision,
    });
    ledger = createPostgresShanbayBackfill(adapter);
    await discover(["quux", "zzyzx", "apple"]);
    await expect(execute({ action: "claim" })).resolves.toMatchObject({
      batch: null,
      status: { unresolvedCount: 0, pendingCount: 0 },
    });
    expect((await ledger.unresolved(ownerA)).items).toEqual([]);
  });

  it("retains confirmed ledger entries when their cloud WordEntry is deleted and recreated", async () => {
    await enable();
    await insertWord("apple");
    await execute({ action: "reconcile", cursor: null });
    await confirm(batch(await execute({ action: "claim" })));
    await database.query("DELETE FROM word_entries WHERE owner_user_id=$1", [ownerA]);
    ledger = createPostgresShanbayBackfill(adapter);
    await insertWord("apple");
    await execute({ action: "reconcile", cursor: null });
    await expect(execute({ action: "claim" })).resolves.toMatchObject({
      batch: null,
      status: { pendingCount: 0, unresolvedCount: 0, unknownCount: 0 },
    });
    expect((await database.query(`SELECT headword FROM shanbay_backfill_sources`)).rows).toEqual([
      { headword: "apple" },
    ]);
  });

  it("enforces direct owner RLS and cascades all ledger rows only for the deleted owner", async () => {
    for (const owner of [ownerA, ownerB]) {
      await enable(owner);
      await execute(
        { action: "discover", origin: "eudic", headwords: ["apple"] },
        "discover",
        owner,
      );
      await execute({ action: "claim" }, "claim", owner);
    }
    for (const table of tables) {
      await adapter.transaction(ownerA, async ({ tenant }) => {
        expect(
          await tenant.rows(`SELECT * FROM ${table} WHERE owner_user_id=$1`, [ownerB]),
        ).toEqual([]);
        expect(
          await tenant.rows(`DELETE FROM ${table} WHERE owner_user_id=$1 RETURNING owner_user_id`, [
            ownerB,
          ]),
        ).toEqual([]);
      });
    }
    await expect(
      adapter.transaction(ownerA, ({ tenant }) =>
        tenant.rows(
          `UPDATE shanbay_backfill_accounts SET owner_user_id=$1 WHERE owner_user_id=$2`,
          [ownerB, ownerA],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      adapter.transaction(ownerA, ({ tenant }) =>
        tenant.rows(
          `INSERT INTO shanbay_backfill_sources(owner_user_id,headword,record) VALUES($1,'intrusion',$2::jsonb)`,
          [ownerB, JSON.stringify(source("intrusion"))],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await database.query("DELETE FROM user_profiles WHERE user_id=$1", [ownerA]);
    for (const table of tables) {
      expect((await database.query(`SELECT owner_user_id FROM ${table}`)).rows).toEqual([
        { owner_user_id: ownerB },
      ]);
    }
  });
});

import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackfillState, ShanbayBackfillCommand } from "@huayi/cloud-contracts";
import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresShanbayBackfill } from "./postgres-shanbay-backfill.js";
import { loadBackfillState } from "./postgres-shanbay-backfill-state.js";
import { exportShanbayBackfill } from "./postgres-shanbay-backfill-export.js";

const owner = "00000000-0000-0000-0000-00000000000a";
const other = "00000000-0000-0000-0000-00000000000b";
const words = Array.from(
  { length: 40 },
  (_, i) => `word${String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26))}`,
);
const now = "2026-09-16T08:00:00.000Z";
const source = (headword: string, target = headword): BackfillState["sources"][string] => ({
  headword,
  target,
  origins: ["local"],
  attempt: "original",
  state: "pending",
  updatedAt: now,
});

describe("Postgres unknown review dismissal", () => {
  let db: PGlite;
  let adapter: AnalysisDatabase;
  let ledger: ReturnType<typeof createPostgresShanbayBackfill>;
  let nonce: number;
  let failBatch: boolean;
  let statements: string[];
  beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    for (const file of ["0001-cloud-v1-foundation.sql", "0039-shanbay-backfill.sql"])
      await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    nonce = 0;
    failBatch = false;
    statements = [];
    adapter = {
      transaction: (user, operation) =>
        db.transaction(async (tx) => {
          await tx.exec("SET LOCAL ROLE huayi_context_setter");
          await tx.query("SELECT huayi_private.set_owner_context($1)", [user]);
          const query = (role: "huayi_business" | "huayi_context_setter"): AnalysisQuery => ({
            rows: async <Row>(text: string, parameters: readonly unknown[] = []) => {
              statements.push(text);
              if (failBatch && text.startsWith("INSERT INTO shanbay_backfill_batches"))
                throw new Error("Injected batch write failure.");
              await tx.exec(`SET LOCAL ROLE ${role}`);
              return (await tx.query<Row>(text, [...parameters])).rows;
            },
          });
          return operation({
            tenant: query("huayi_business"),
            trusted: query("huayi_context_setter"),
          });
        }),
      trusted: async () => {
        throw new Error("Must use an account transaction.");
      },
    };
    ledger = createPostgresShanbayBackfill(adapter);
    for (const user of [owner, other]) {
      await db.query(
        "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,$2,'active','UTC',5)",
        [user, `${user}@example.test`],
      );
      await execute({ action: "settings", enabled: true, dailyHour: 8, expectedRevision: 0 }, user);
    }
  });
  afterEach(async () => {
    await db.close();
  });
  function execute(command: ShanbayBackfillCommand, user = owner, key = `write-${nonce++}`) {
    return ledger.execute(user, "device", key, command);
  }
  function state(user = owner) {
    return adapter.transaction(user, ({ tenant }) => loadBackfillState(tenant));
  }
  async function seed() {
    await execute({ action: "discover", origin: "local", headwords: words });
    const tokens = [];
    for (let i = 0; i < 2; i++) {
      const claim = await execute({ action: "claim", limit: 20 });
      if (!claim.batch) throw new Error("Expected batch.");
      tokens.push(claim.batch.token);
      await execute({ action: "unknown", token: claim.batch.token });
    }
    return tokens;
  }

  it("atomically clears two twenty-word batches under lock and fences revisions, account scope and exact replay", async () => {
    const tokens = await seed();
    await execute({ action: "adopt", sources: [], confirmed: [], unknown: ["private"] }, other);
    const otherBefore = await state(other);
    const before = await state();
    const status = await ledger.status(owner);
    expect(status).toMatchObject({ pendingCount: 0, unresolvedCount: 0, unknownCount: 40 });
    const command = { action: "discard-review" as const, expectedRevision: status.revision };
    await expect(
      execute({ ...command, expectedRevision: status.revision - 1 }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(await state()).toEqual(before);
    statements = [];
    const result = await execute(command, owner, "dismiss");
    expect(result).toMatchObject({
      accepted: true,
      status: { unknownCount: 0, revision: status.revision + 1 },
    });
    expect(statements.some((sql) => sql.includes("FOR UPDATE"))).toBe(true);
    expect(await execute(command, owner, "dismiss")).toEqual(result);
    await expect(
      execute({ ...command, expectedRevision: result.status.revision }, owner, "dismiss"),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(await state(other)).toEqual(otherBefore);
    expect(await ledger.unresolved(owner)).toMatchObject({
      items: [],
      unknownBatches: [],
      nextCursor: null,
    });
    for (const token of tokens) {
      expect(await execute({ action: "retry-unknown", token })).toMatchObject({ accepted: false });
      expect(
        await execute({ action: "resolve", token, confirmed: words.slice(0, 20), rejected: [] }),
      ).toMatchObject({ accepted: false });
    }
    await execute({ action: "discover", origin: "eudic", headwords: words });
    expect((await execute({ action: "claim" })).batch).toBeNull();
    const after = await state();
    expect(after.targets).toEqual(before.targets);
    expect(after.batches.every((batch) => batch.state === "unknown" && batch.dismissedAt)).toBe(
      true,
    );
    expect(Object.values(after.sources).every((item) => item.state === "discarded")).toBe(true);
  });

  it("rolls back sources, batches, revision and idempotency when persistence fails then retries the same key", async () => {
    await seed();
    const before = await state();
    const revision = (await ledger.status(owner)).revision;
    const command = { action: "discard-review" as const, expectedRevision: revision };
    failBatch = true;
    await expect(execute(command, owner, "retry")).rejects.toThrow("Injected batch write failure.");
    expect(await state()).toEqual(before);
    expect((await ledger.status(owner)).revision).toBe(revision);
    failBatch = false;
    expect(await execute(command, owner, "retry")).toMatchObject({
      accepted: true,
      status: { revision: revision + 1, unknownCount: 0 },
    });
  });

  it("dismisses a source-less adopted batch and applies its durable target decision to later mapped sources and imports", async () => {
    const adopted = await execute({
      action: "adopt",
      sources: [],
      confirmed: [],
      unknown: ["walk"],
    });
    const [batch] = (await ledger.unresolved(owner)).unknownBatches;
    if (!batch) throw new Error("Expected unknown batch.");
    const command = {
      action: "discard-unknown" as const,
      token: batch.token,
      expectedRevision: adopted.status.revision,
    };
    const cleared = await execute(command);
    expect(cleared).toMatchObject({ accepted: true, status: { unknownCount: 0 } });
    await execute({
      action: "adopt",
      sources: [source("walking", "walk"), source("walk")],
      confirmed: [],
      unknown: ["walk"],
    });
    await execute({
      action: "adopt",
      sources: [source("walking", "walk")],
      confirmed: [],
      dismissed: [{ headwords: ["walk"], dismissedAt: now }],
    });
    expect((await execute({ action: "claim" })).batch).toBeNull();
    const saved = await state();
    expect(saved.batches).toHaveLength(1);
    expect(saved.sources.walking?.state).toBe("discarded");
    expect(saved.targets.walk?.confirmedAt).toBeNull();
    const records = await adapter.transaction(owner, ({ tenant }) => exportShanbayBackfill(tenant));
    const exported = records.find((record) => record.recordType === "shanbay-backfill-batch");
    expect(exported).toMatchObject({
      batch: { state: "unknown", dismissedAt: saved.batches[0]?.dismissedAt },
    });
    expect(JSON.stringify(records)).not.toContain(batch.token);
    expect(JSON.stringify(records)).not.toContain('"holder"');
  });

  it("retains evidence uploaded before interrupted source adoption and deduplicates subsequent evidence", async () => {
    const dismissed = [{ headwords: ["walk"], dismissedAt: now }];
    await execute({ action: "adopt", sources: [], confirmed: [], dismissed });
    expect((await state()).sources).toEqual({});
    expect((await ledger.status(owner)).unknownCount).toBe(0);
    await execute({ action: "adopt", sources: [source("walking", "walk")], confirmed: [] });
    await execute({ action: "adopt", sources: [], confirmed: [], dismissed });
    expect((await state()).batches).toHaveLength(1);
    expect((await state()).sources.walking?.state).toBe("discarded");
    expect((await execute({ action: "claim" })).batch).toBeNull();
  });
});

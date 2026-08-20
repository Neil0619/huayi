import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresDuplicateSuggestionMaintenance } from "./postgres-duplicate-suggestion-maintenance.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userId = "00000000-0000-0000-0000-00000000000a";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres duplicate suggestion authority", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    await database.exec(`INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userId}','${userId}','a@example.test','active','UTC',5);
      INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content)
      VALUES('60000000-0000-0000-0000-000000000001','${userId}','expression','source',
        '{"type":"expression","text":"source","meaningZh":"来源","usageZh":"来源。"}');`);
  });

  afterEach(async () => database.close());

  it("forces RLS while denying the business role every direct table privilege", async () => {
    const authority = await database.query<{
      can_delete: boolean;
      can_insert: boolean;
      can_select: boolean;
      can_update: boolean;
      relforcerowsecurity: boolean;
      relrowsecurity: boolean;
    }>(`SELECT relrowsecurity,relforcerowsecurity,
      has_table_privilege('huayi_business','learning_duplicate_suggestion_requests','SELECT') can_select,
      has_table_privilege('huayi_business','learning_duplicate_suggestion_requests','INSERT') can_insert,
      has_table_privilege('huayi_business','learning_duplicate_suggestion_requests','UPDATE') can_update,
      has_table_privilege('huayi_business','learning_duplicate_suggestion_requests','DELETE') can_delete
      FROM pg_class WHERE relname='learning_duplicate_suggestion_requests'`);
    expect(authority.rows).toEqual([
      {
        can_delete: false,
        can_insert: false,
        can_select: false,
        can_update: false,
        relforcerowsecurity: true,
        relrowsecurity: true,
      },
    ]);
    await database.transaction(async (transaction) => {
      await transaction.exec(`SELECT huayi_private.set_owner_context('${userId}')`);
      await transaction.exec("SET LOCAL ROLE huayi_business");
      await expect(
        transaction.query("SELECT count(*) FROM learning_duplicate_suggestion_requests"),
      ).rejects.toThrow();
    });
  });

  it("deletes no more than 100 expired terminal rows per maintenance batch", async () => {
    await database.exec(`INSERT INTO learning_duplicate_suggestion_requests(
      id,owner_user_id,source_item_id,source_revision,idempotency_key,request_hash,state,generation,
      lease_token,lease_expires_at,reservation_id,price_version_id,candidate_aliases,response,
      created_at,updated_at,expires_at
    ) SELECT md5('duplicate-'||value::text)::uuid,'${userId}',
      '60000000-0000-0000-0000-000000000001',1,'key-'||value::text,repeat('a',64),'completed',1,
      'lease','2026-08-14T00:01:00Z',NULL,NULL,
      '[{"alias":"candidate-1","itemId":"60000000-0000-0000-0000-000000000001","itemRevision":1}]',
      '{"itemRevision":1,"suggestions":[]}',
      '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','2026-08-14T01:00:00Z'
      FROM generate_series(1,101) value;`);
    const adapter: AnalysisDatabase = {
      async transaction() {
        throw new Error("Tenant transaction not used.");
      },
      async trusted(operation) {
        return operation(query(database));
      },
    };
    let ordinal = 0;
    const maintenance = createPostgresDuplicateSuggestionMaintenance({
      database: adapter,
      ledgerId: () => `a0000000-0000-4000-8000-${String(++ordinal).padStart(12, "0")}`,
      now: () => new Date("2026-08-14T02:00:00.000Z"),
    });
    await expect(maintenance.runBatch()).resolves.toEqual({ abandonedCount: 0, deletedCount: 100 });
    const remaining = await database.query<{ count: number }>(
      "SELECT count(*)::integer count FROM learning_duplicate_suggestion_requests",
    );
    expect(remaining.rows).toEqual([{ count: 1 }]);
  });

  it("cascades short-lived requests when the account is deleted", async () => {
    await database.exec(`INSERT INTO learning_duplicate_suggestion_requests(
      id,owner_user_id,source_item_id,source_revision,idempotency_key,request_hash,state,generation,
      lease_token,lease_expires_at,candidate_aliases,created_at,updated_at,expires_at
    ) VALUES('70000000-0000-0000-0000-000000000001','${userId}',
      '60000000-0000-0000-0000-000000000001',1,'delete-me',repeat('a',64),'running',1,
      'lease','2026-08-14T00:01:00Z',
      '[{"alias":"candidate-1","itemId":"60000000-0000-0000-0000-000000000001","itemRevision":1}]',
      '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z',
      '2026-08-15T00:00:00Z');
    DELETE FROM user_profiles WHERE user_id='${userId}';`);
    const remaining = await database.query<{ count: number }>(
      "SELECT count(*)::integer count FROM learning_duplicate_suggestion_requests",
    );
    expect(remaining.rows).toEqual([{ count: 0 }]);
  });
});

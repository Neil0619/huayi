import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";

import { createPostgresExtensionQueryStore } from "./postgres-extension-query.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";

const userId = "00000000-0000-4000-8000-000000000001";
const generationId = "00000000-0000-4000-8000-000000000002";
const reservationId = "00000000-0000-4000-8000-000000000003";
const priceId = "00000000-0000-4000-8000-000000000004";
const now = new Date("2026-09-10T02:00:00Z");
let database: PGlite;

beforeEach(async () => {
  database = new PGlite();
  await database.waitReady;
  await database.exec(
    await readFile(new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url), "utf8"),
  );
  await database.exec(`
    INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
    VALUES('${userId}','${userId}','fixture@example.test','active','UTC',5);
    INSERT INTO quota_reservations(
      id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at
    ) VALUES('${reservationId}','${userId}','${userId}','${generationId}',
      '2026-09-01T00:00:00Z',500,'active','2026-09-10T02:05:00Z');
    INSERT INTO extension_query_generations(
      id,owner_user_id,idempotency_key,request_hash,state,request,lease_token,lease_expires_at,
      reservation_id,expires_at,created_at,updated_at
    ) VALUES('${generationId}','${userId}','identity-test','${"a".repeat(64)}','running',
      '{"action":"explain","selectionKind":"sentence","sourceText":"fixture","sourceType":"web-selection"}',
      'lease','2026-09-10T02:05:00Z','${reservationId}',
      '2026-09-10T03:00:00Z','2026-09-10T02:00:00Z','2026-09-10T02:00:00Z');
  `);
});
afterEach(async () => database.close());

it.each([
  ["deepseek-flash", 2, true],
  ["deepseek-v4-flash", 2, false],
  ["deepseek-v4-pro", 2, false],
  ["deepseek-flash", 99, false],
] as const)(
  "validates dispatch against immutable model %s and input price %s",
  async (model, inputPrice, succeeds) => {
    // Synthetic prices test the identity boundary; these are not official model tariffs.
    await database.query(
      `INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,
      cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from)
      VALUES($1,'deepseek',$2,$3,1,3,'2026-09-10T00:00:00Z')`,
      [priceId, model, inputPrice],
    );
    const store = createPostgresExtensionQueryStore({
      database: createPgliteAnalysisDatabase(database),
      ledgerId: () => "00000000-0000-4000-8000-000000000005",
      now: () => now,
      priceVersionId: priceId,
    });
    const dispatch = store.markDispatched({
      id: generationId,
      leaseToken: "lease",
      userId,
      pricing: {
        tier: "off-peak",
        priceVersionId: priceId,
        prices: {
          inputMicroUsdPerMillionTokens: 2,
          cachedInputMicroUsdPerMillionTokens: 1,
          outputMicroUsdPerMillionTokens: 3,
        },
      },
    });
    if (succeeds) await expect(dispatch).resolves.toBeUndefined();
    else await expect(dispatch).rejects.toMatchObject({ code: "model_unavailable" });

    const generation = await database.query(
      "SELECT dispatched_at,price_version_id FROM extension_query_generations WHERE id=$1",
      [generationId],
    );
    expect(generation.rows).toEqual([
      { dispatched_at: succeeds ? now : null, price_version_id: succeeds ? priceId : null },
    ]);
    const saved = await database.query(
      "SELECT model,input_micro_usd_per_million::int AS input_price FROM model_price_versions WHERE id=$1",
      [priceId],
    );
    expect(saved.rows).toEqual([{ model, input_price: inputPrice }]);
  },
);

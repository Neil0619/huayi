import type { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  extensionQueryEventReadSchema,
  extensionQueryGenerationRequestSchema,
  extensionQueryHttpRoutes,
  structuredTeachingAccept,
} from "@huayi/cloud-contracts";
import { createCurrentDatabaseFixture } from "./test-support/current-database-fixture.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { createPostgresExtensionQueryStore } from "./postgres-extension-query.js";
import { createPostgresAnalysisQuota } from "./postgres-analysis-quota.js";
import { createPostgresAccountDataExportSource } from "./postgres-account-data-export-source.js";
import { createExtensionQueryModule } from "./extension-query-module.js";
import { createExtensionQueryApp } from "./extension-query-app.js";
import { createDeepSeekExtensionQueryModel } from "./deepseek-extension-query-model.js";
import {
  acceptanceProviderFetch,
  LOCAL_ACCEPTANCE_PROVIDER_KEY,
} from "./acceptance-provider-fetch.js";

const owner = "10000000-0000-4000-8000-000000000001",
  price = "20000000-0000-4000-8000-000000000001";
let database: PGlite;
const input = extensionQueryGenerationRequestSchema.parse({
  action: "explain",
  outputContract: "structured-teaching-v1",
  selectionKind: "passage",
  sourceType: "web-selection",
  sourceText: '  "Go now."\r\nWe can.  ',
});
const now = new Date();
const prices = {
  cachedInputMicroUsdPerMillionTokens: 1,
  inputMicroUsdPerMillionTokens: 2,
  outputMicroUsdPerMillionTokens: 3,
};
beforeAll(async () => {
  database = await createCurrentDatabaseFixture();
  await database.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'query@example.test','active','UTC',5)",
    [owner],
  );
  await database.query(
    "INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from) VALUES($1,'deepseek','deepseek-flash',2,1,3,'2026-08-01')",
    [price],
  );
  // Only this disposable PGlite fixture enables its simulated provider.
  await database.query(
    "INSERT INTO runtime_controls(name,enabled,updated_by) VALUES('model_kill_switch',false,$1)",
    [owner],
  );
});
afterAll(async () => database.close());
function fixture() {
  const adapter = createPgliteAnalysisDatabase(database);
  const store = createPostgresExtensionQueryStore({
    database: adapter,
    ledgerId: randomUUID,
    now: () => now,
    priceVersionId: price,
  });
  const quota = createPostgresAnalysisQuota({
    database: adapter,
    id: randomUUID,
    now: () => now,
    priceVersionId: price,
    expiresAt: () => new Date(now.getTime() + 300_000),
    prices,
    providerModel: "deepseek-flash",
  });
  const provider = vi.fn(acceptanceProviderFetch);
  const module = createExtensionQueryModule({
    store,
    quota,
    ids: randomUUID,
    now: () => now,
    priceVersionId: price,
    reservedCostMicroUsd: () => 500,
    model: createDeepSeekExtensionQueryModel({
      apiKey: LOCAL_ACCEPTANCE_PROVIDER_KEY,
      fetch: provider,
      prices,
    }),
  });
  const app = createExtensionQueryApp({ authenticate: () => owner, module });
  return { adapter, store, quota, provider, module, app };
}
it("writes through the native provider, Hono, lease and ledger, then replays/exports without leaking its private configuration", async () => {
  const f = fixture();
  await f.quota.summary(owner);
  const start = (accept: string) =>
    f.app.request(extensionQueryHttpRoutes.start, {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "native-persistence",
        Accept: accept,
      },
    });
  const response = await start(structuredTeachingAccept.eventStream);
  expect(response.status).toBe(200);
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => extensionQueryEventReadSchema.parse(JSON.parse(line.slice(6))));
  const done = events.at(-1);
  if (done?.type !== "query.completed") throw new Error("Expected native completion.");
  expect(done.result).toMatchObject({ type: "explain-sentence-v2", sourceText: input.sourceText });
  expect(events.filter((event) => event.type === "query.structure")).toHaveLength(2);
  const saved = (
    await database.query<{ request: unknown; request_hash: string }>(
      "SELECT request,request_hash FROM extension_query_generations WHERE id=$1",
      [done.generationId],
    )
  ).rows[0];
  expect(saved?.request).toMatchObject({
    ...input,
    _generation: { identity: { model: "deepseek-flash", resultType: "explain-sentence-v2" } },
  });
  expect(saved?.request_hash).toBe(
    createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  );
  await database.query(
    "UPDATE extension_query_generations SET request=jsonb_set(request,'{_generation,identity,model}','\"old-deployment\"') WHERE id=$1",
    [done.generationId],
  );
  const legacy = await start("text/event-stream");
  const legacyWire = await legacy.text();
  expect(legacyWire).toContain('"type":"explain-sentence"');
  expect(legacyWire).not.toContain("_generation");
  const records = await createPostgresAccountDataExportSource(f.adapter).records(
    owner,
    now.toISOString(),
  );
  const exported = records.find(
    (row) => row.recordType === "extension-query-generation" && row.id === done.generationId,
  );
  expect(exported).toMatchObject({
    outputContract: "structured-teaching-v1",
    sourceText: input.sourceText,
    result: { type: "explain-sentence-v2" },
  });
  expect(JSON.stringify(exported)).not.toMatch(/_generation|executionDigest|old-deployment/u);
  expect(f.provider).toHaveBeenCalledTimes(1);
  expect(
    (await database.query("SELECT 1 FROM usage_ledger WHERE request_id=$1", [done.generationId]))
      .rows,
  ).toHaveLength(1);
});
it("releases its reservation at zero cost if the saved native configuration fails the pre-dispatch check", async () => {
  const f = fixture();
  const events = await f.module.prepare({
    userId: owner,
    idempotencyKey: "native-invalid-config",
    input,
  });
  await database.query(
    "UPDATE extension_query_generations SET request=request-'_generation' WHERE idempotency_key='native-invalid-config'",
  );
  const output = [];
  for await (const event of events) output.push(event);
  expect(output.at(-1)).toMatchObject({
    type: "query.failed",
    error: { code: "model_unavailable" },
  });
  expect(f.provider).not.toHaveBeenCalled();
  expect((await f.quota.summary(owner)).reservedMicroUsd).toBe(0);
  const ledger = await database.query<{ cost: string }>(
    "SELECT cost_micro_usd::text AS cost FROM usage_ledger WHERE request_id=(SELECT id FROM extension_query_generations WHERE idempotency_key='native-invalid-config')",
  );
  expect(ledger.rows).toEqual([{ cost: "0" }]);
});

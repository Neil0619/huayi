import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import * as bootstrap from "./acceptance-local-bootstrap.mjs";

const {
  bootstrapSql,
  parseContainerEnvironment,
  readAcceptanceGeneratedValues,
  renderAcceptanceEnvironment,
} = bootstrap;
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");

const priceIds = {
  legacyPriceVersionId: "10000000-0000-4000-8000-000000000001",
  offPeakPriceVersionId: "10000000-0000-4000-8000-000000000002",
  peakPriceVersionId: "10000000-0000-4000-8000-000000000003",
  latestOffPeakPriceVersionId: "10000000-0000-4000-8000-000000000004",
  latestPeakPriceVersionId: "10000000-0000-4000-8000-000000000005",
};
const values = {
  ...priceIds,
  cronSecret: "c".repeat(43),
  databasePassword: "d".repeat(32),
  pepper: "p".repeat(43),
  publishableKey: "publishable-local-value",
  refreshEncryptionKey: "r".repeat(43),
  serviceRoleKey: "secret-local-value",
};

test("local bootstrap provisions and verifies five exact immutable deepseek-flash snapshots", () => {
  const sql = bootstrapSql(values);
  const expected = [
    [priceIds.legacyPriceVersionId, "140000, 2800, 280000", "2026-08-16T15:59:59Z"],
    [priceIds.offPeakPriceVersionId, "220000, 7000, 660000", "2026-08-16T16:00:00Z"],
    [priceIds.peakPriceVersionId, "440000, 14000, 1320000", "2026-08-16T16:00:01Z"],
    [priceIds.latestOffPeakPriceVersionId, "149081, 2982, 596323", "2026-09-10T04:00:00Z"],
    [priceIds.latestPeakPriceVersionId, "298162, 5964, 1192646", "2026-09-10T06:00:00Z"],
  ];
  for (const [id, prices, effectiveAt] of expected) {
    assert.ok(sql.includes(`('${id}', 'deepseek', 'deepseek-flash', ${prices}, '${effectiveAt}')`));
    assert.ok(sql.includes(`'${id}', 'deepseek', 'deepseek-flash', ${prices}\n)`));
  }
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING;/u);
  assert.doesNotMatch(sql, /UPDATE (?:public\.)?model_price_versions|deepseek-v4-flash/u);
});

test("local bootstrap writes both dated UUID keys and reuses all five on rerun", () => {
  const rendered = renderAcceptanceEnvironment(values);
  assert.ok(
    rendered.includes(
      `HUAYI_DEEPSEEK_20260910_OFF_PEAK_PRICE_VERSION_ID=${priceIds.latestOffPeakPriceVersionId}`,
    ),
  );
  assert.ok(
    rendered.includes(
      `HUAYI_DEEPSEEK_20260910_PEAK_PRICE_VERSION_ID=${priceIds.latestPeakPriceVersionId}`,
    ),
  );
  const restored = readAcceptanceGeneratedValues(rendered, () => assert.fail("must reuse IDs"));
  for (const [key, value] of Object.entries(priceIds)) assert.equal(restored[key], value);
  assert.equal(restored.databasePassword, values.databasePassword);
  assert.equal(restored.pepper, values.pepper);
});

test("local bootstrap upgrades an old local file with five fresh IDs and keeps credentials", () => {
  const old = renderAcceptanceEnvironment(values)
    .split("\n")
    .filter((line) => !line.startsWith("HUAYI_DEEPSEEK_20260910_"))
    .join("\n");
  let sequence = 10;
  const upgraded = readAcceptanceGeneratedValues(
    old,
    () => `20000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  );
  const newIds = Object.keys(priceIds).map((key) => upgraded[key]);
  assert.equal(new Set(newIds).size, 5);
  assert.ok(newIds.every((id) => !Object.values(priceIds).includes(id)));
  assert.equal(upgraded.databasePassword, values.databasePassword);
  assert.equal(upgraded.cronSecret, values.cronSecret);
  assert.equal(upgraded.refreshEncryptionKey, values.refreshEncryptionKey);
});

test("local bootstrap rejects partial, invalid, or duplicate dated IDs before emitting SQL", () => {
  for (const field of Object.keys(priceIds)) {
    assert.throws(
      () => bootstrapSql({ ...values, [field]: undefined }),
      /Local acceptance price IDs are invalid/u,
    );
    assert.throws(
      () => renderAcceptanceEnvironment({ ...values, [field]: "invalid" }),
      /Local acceptance price IDs are invalid/u,
    );
  }
  assert.throws(
    () => bootstrapSql({ ...values, latestOffPeakPriceVersionId: values.peakPriceVersionId }),
    /Local acceptance price IDs are invalid/u,
  );
  const partial = renderAcceptanceEnvironment(values).replace(
    /^HUAYI_DEEPSEEK_20260910_PEAK_PRICE_VERSION_ID=.*\n/mu,
    "",
  );
  assert.throws(
    () => readAcceptanceGeneratedValues(partial),
    /Local acceptance environment is invalid/u,
  );
  const incompleteOld = partial
    .replace(/^HUAYI_DEEPSEEK_20260910_OFF_PEAK_PRICE_VERSION_ID=.*\n/mu, "")
    .replace(/^HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID=.*\n/mu, "");
  assert.throws(
    () => readAcceptanceGeneratedValues(incompleteOld),
    /Local acceptance environment is invalid/u,
  );
});

test("local bootstrap SQL runs twice without rewriting historical or current price rows", async () => {
  const database = new PGlite();
  try {
    await database.waitReady;
    await database.exec(
      await readFile(
        new URL("../apps/api/migrations/0001-cloud-v1-foundation.sql", import.meta.url),
        "utf8",
      ),
    );
    await database.exec(`CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,updated_at timestamptz);
      INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,
        cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from)
      VALUES ('30000000-0000-4000-8000-000000000001','deepseek','deepseek-v4-flash',
        140000,2800,280000,'2026-08-16T15:59:59Z');`);
    const historical = (await database.query("SELECT * FROM model_price_versions")).rows;
    await database.exec(bootstrapSql(values));
    const first = (await database.query("SELECT * FROM model_price_versions ORDER BY id")).rows;
    await database.exec(bootstrapSql(values));
    const second = (await database.query("SELECT * FROM model_price_versions ORDER BY id")).rows;
    assert.deepEqual(second, first);
    assert.equal(second.length, 6);
    assert.deepEqual(
      second.filter((row) => row.model === "deepseek-v4-flash"),
      historical,
    );
    assert.equal(second.filter((row) => row.model === "deepseek-flash").length, 5);
    await assert.rejects(
      database.exec(
        bootstrapSql({ ...values, legacyPriceVersionId: "30000000-0000-4000-8000-000000000001" }),
      ),
      /model price mismatch/u,
    );
    assert.deepEqual(
      (await database.query("SELECT * FROM model_price_versions ORDER BY id")).rows,
      first,
    );
  } finally {
    await database.close();
  }
});

test("acceptance bootstrap extracts only the required local Supabase keys", () => {
  const values = parseContainerEnvironment([
    "UNRELATED=value",
    "SUPABASE_PUBLISHABLE_KEY=publishable-local-value",
    "SUPABASE_SECRET_KEY=secret-local-value",
  ]);

  assert.deepEqual(values, {
    publishableKey: "publishable-local-value",
    serviceRoleKey: "secret-local-value",
  });
  assert.throws(
    () => parseContainerEnvironment(["SUPABASE_PUBLISHABLE_KEY=publishable-only"]),
    /Local Supabase credentials are unavailable\./u,
  );
});

test("acceptance bootstrap renders a secret file without a provider key", () => {
  const rendered = renderAcceptanceEnvironment({
    ...priceIds,
    cronSecret: "c".repeat(43),
    databasePassword: "d".repeat(32),
    legacyPriceVersionId: "10000000-0000-4000-8000-000000000001",
    offPeakPriceVersionId: "10000000-0000-4000-8000-000000000002",
    peakPriceVersionId: "10000000-0000-4000-8000-000000000003",
    pepper: "p".repeat(43),
    publishableKey: "publishable-local-value",
    refreshEncryptionKey: "r".repeat(43),
    serviceRoleKey: "secret-local-value",
  });

  assert.match(rendered, /^VITE_API_ORIGIN=https:\/\/api\.acceptance\.localhost:8444$/mu);
  assert.match(rendered, /^SUPABASE_URL=https:\/\/supabase\.acceptance\.localhost:8445$/mu);
  assert.match(rendered, /^HUAYI_DATABASE_URL=postgresql:\/\/huayi_acceptance_login:/mu);
  assert.doesNotMatch(rendered, /HUAYI_DEEPSEEK_API_KEY/u);
  assert.match(rendered, /^HUAYI_SECURITY_NOTIFICATION_MODE=disabled-local-acceptance$/mu);
  assert.doesNotMatch(rendered, /HUAYI_RESEND_API_KEY/u);
  assert.doesNotMatch(rendered, /REPLACE_WITH/u);
});

test("acceptance bootstrap provisions only the fixed private export bucket", () => {
  const sql = bootstrapSql({
    ...priceIds,
    databasePassword: "database-password",
    legacyPriceVersionId: "10000000-0000-4000-8000-000000000001",
    offPeakPriceVersionId: "10000000-0000-4000-8000-000000000002",
    peakPriceVersionId: "10000000-0000-4000-8000-000000000003",
  });

  assert.match(sql, /INSERT INTO storage\.buckets/u);
  assert.match(sql, /'account-exports-acceptance'/u);
  assert.match(sql, /VALUES \([^;]+false\)/su);
  assert.match(sql, /ON CONFLICT \(id\) DO UPDATE SET[\s\S]+public = false/u);
  assert.doesNotMatch(sql, /serviceRoleKey|SUPABASE_SECRET_KEY/u);
});

test("acceptance bootstrap enables only the visibly simulated local model path", () => {
  const sql = bootstrapSql({
    ...priceIds,
    databasePassword: "database-password",
    legacyPriceVersionId: "10000000-0000-4000-8000-000000000001",
    offPeakPriceVersionId: "10000000-0000-4000-8000-000000000002",
    peakPriceVersionId: "10000000-0000-4000-8000-000000000003",
  });

  assert.match(
    sql,
    /INSERT INTO public\.runtime_controls \(name, enabled\)[\s\S]+VALUES \('model_kill_switch', false\)[\s\S]+enabled = false/u,
  );
});

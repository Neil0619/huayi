import assert from "node:assert/strict";
import test from "node:test";

import {
  bootstrapSql,
  parseContainerEnvironment,
  renderAcceptanceEnvironment,
} from "./acceptance-local-bootstrap.mjs";

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

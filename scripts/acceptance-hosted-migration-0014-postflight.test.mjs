import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  parseHostedMigration0014PostflightOutput,
  renderHostedMigration0014PostflightSql,
} from "./acceptance-hosted-migration-0014-apply.mjs";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");
const apiBaselineUrl = new URL(
  "../apps/api/migrations/0001-cloud-v1-foundation.sql",
  import.meta.url,
);
const apiForwardUrl = new URL(
  "../apps/api/migrations/0014-password-signup-otp-resend.sql",
  import.meta.url,
);

test("0014 apply postflight is read-only and binds migration identity plus ACL", () => {
  const sql = renderHostedMigration0014PostflightSql();
  assert.match(sql, /BEGIN READ ONLY;/u);
  assert.match(sql, /supabase_migrations\.schema_migrations/u);
  assert.match(sql, /20260824010000/u);
  assert.match(sql, /column_name = 'bound_email'/u);
  assert.match(sql, /target_constraint\.conname = 'invitation_claims_bound_email_check'/u);
  assert.match(sql, /pg_get_expr\(target_constraint\.conbin, target_constraint\.conrelid\)/u);
  assert.match(sql, /\(\(bound_email IS NULL\) OR \(bound_email = lower\(bound_email\)\)\)/u);
  assert.match(sql, /bind_auth_identity\(text,uuid\)/u);
  assert.match(sql, /renew_interrupted_password_confirmation\(text,text,timestamptz\)/u);
  assert.match(
    sql,
    /procedure\.proargnames = ARRAY\[\s*'invitation_token_hash',\s*'new_flow_hash',\s*'new_expires_at',\s*'account_email'\s*\]::text\[\]/u,
  );
  assert.match(sql, /procedure\.proargmodes = ARRAY\['i', 'i', 'i', 't'\]::"char"\[\]/u);
  assert.match(sql, /procedure\.proallargtypes = ARRAY\[\s*'text'::regtype/u);
  assert.match(sql, /procedure\.proretset/u);
  assert.match(sql, /procedure\.prorettype = 'text'::regtype/u);
  assert.doesNotMatch(sql, /procedure\.prorettype = 'record'::regtype/u);
  assert.match(sql, /procedure\.prosecdef/u);
  assert.match(sql, /search_path=pg_catalog/u);
  assert.match(sql, /aclexplode/u);
  assert.match(sql, /privilege\.grantee = procedure\.proowner/u);
  assert.match(sql, /count\(\*\) = 2/u);
  assert.match(sql, /huayi_context_setter/u);
  assert.match(sql, /huayi_business/u);
  assert.match(sql, /huayi_runtime/u);
  assert.match(sql, /ROLLBACK;/u);
  assert.equal(parseHostedMigration0014PostflightOutput("t\n"), true);
  for (const value of ["", "f\n", "t\nt\n", " t\n", "t\r\n", "truth\n"]) {
    assert.equal(parseHostedMigration0014PostflightOutput(value), false);
  }
});

test("0014 apply postflight accepts the real single-column RETURNS TABLE catalog", async () => {
  const database = new PGlite();
  try {
    await database.waitReady;
    await database.exec(await readFile(apiBaselineUrl, "utf8"));
    await database.exec(await readFile(apiForwardUrl, "utf8"));
    await database.exec(`
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations(version)
      VALUES
        ('20260821000000'),('20260821010000'),('20260821020000'),('20260821030000'),
        ('20260821040000'),('20260821050000'),('20260821060000'),('20260821070000'),
        ('20260821080000'),('20260822010000'),('20260822020000'),('20260822030000'),
        ('20260823010000'),('20260824010000');
    `);
    assert.deepEqual(await database.exec(renderHostedMigration0014PostflightSql()), [
      { affectedRows: 0, fields: [], rows: [] },
      {
        affectedRows: 0,
        fields: [{ dataTypeID: 25, name: "case" }],
        rows: [{ case: "t" }],
      },
      { affectedRows: 0, fields: [], rows: [] },
    ]);
  } finally {
    await database.close();
  }
});

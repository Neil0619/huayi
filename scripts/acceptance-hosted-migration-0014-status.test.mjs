import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  hostedMigration0014StatusAppliedMessage,
  hostedMigration0014StatusArgument,
  hostedMigration0014StatusPendingMessage,
  hostedMigration0014StatusUncertainMessage,
  parseHostedMigration0014StatusOutput,
  renderHostedMigration0014StatusSql,
  runHostedMigration0014StatusCli,
  runHostedMigration0014StatusQuery,
} from "./acceptance-hosted-migration-0014-status.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
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
const migrationVersionsThrough0013 = [
  "20260821000000",
  "20260821010000",
  "20260821020000",
  "20260821030000",
  "20260821040000",
  "20260821050000",
  "20260821060000",
  "20260821070000",
  "20260821080000",
  "20260822010000",
  "20260822020000",
  "20260822030000",
  "20260823010000",
];

async function runCli(overrides = {}) {
  let stderr = "";
  let stdout = "";
  const code = await runHostedMigration0014StatusCli({
    arguments_: [hostedMigration0014StatusArgument],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => "fictional-administrator-password",
    runStatusQuery: async () => "pending_exact",
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
    ...overrides,
  });
  return { code, stderr, stdout };
}

test("package exposes one fixed 0014 read-only status entrypoint", async () => {
  const packageDocument = JSON.parse(
    await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url)),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:migration:0014:status"],
    `node scripts/acceptance-hosted-migration-0014-status.mjs ${hostedMigration0014StatusArgument}`,
  );
  assert.equal(
    hostedMigration0014StatusArgument,
    "--status-20260824010000-password-signup-otp-resend-kpadiulxkgckskcfydry",
  );
});

test("0014 status SQL classifies only exact 14-chain applied and exact 13-chain pending", () => {
  const sql = renderHostedMigration0014StatusSql();
  assert.match(sql, /^\nBEGIN READ ONLY;/u);
  for (const version of ["20260821000000", "20260822030000", "20260823010000", "20260824010000"]) {
    assert.match(sql, new RegExp(version, "u"));
  }
  assert.match(sql, /column_name = 'bound_email'/u);
  assert.match(sql, /invitation_claims_bound_email_check/u);
  assert.match(sql, /bind_auth_identity\(text,uuid\)/u);
  assert.match(sql, /position\('bound_email' IN pg_get_functiondef/u);
  assert.match(sql, /renew_interrupted_password_confirmation\(text,text,timestamptz\)/u);
  assert.match(sql, /procedure\.prorettype = 'text'::regtype/u);
  assert.match(sql, /aclexplode/u);
  assert.match(sql, /has_function_privilege\(\s*'huayi_context_setter',\s*to_regprocedure/u);
  assert.match(sql, /huayi_context_setter/u);
  assert.match(sql, /huayi_business/u);
  assert.match(sql, /huayi_runtime/u);
  assert.match(sql, /'applied_exact'/u);
  assert.match(sql, /'pending_exact'/u);
  assert.match(sql, /ELSE 'uncertain'/u);
  assert.match(sql, /ROLLBACK;\n$/u);
});

test("0014 status SQL classifies exact pending, applied, and drifted PostgreSQL catalog", async () => {
  const database = new PGlite();
  try {
    await database.waitReady;
    await database.exec(await readFile(apiBaselineUrl, "utf8"));
    await database.exec(`
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations(version)
      VALUES ${migrationVersionsThrough0013.map((version) => `('${version}')`).join(",")};
    `);

    assert.deepEqual(await database.exec(renderHostedMigration0014StatusSql()), [
      { affectedRows: 0, fields: [], rows: [] },
      {
        affectedRows: 0,
        fields: [{ dataTypeID: 25, name: "case" }],
        rows: [{ case: "pending_exact" }],
      },
      { affectedRows: 0, fields: [], rows: [] },
    ]);

    await database.exec(await readFile(apiForwardUrl, "utf8"));
    await database.exec(`
      INSERT INTO supabase_migrations.schema_migrations(version)
      VALUES('20260824010000');
    `);
    assert.deepEqual(await database.exec(renderHostedMigration0014StatusSql()), [
      { affectedRows: 0, fields: [], rows: [] },
      {
        affectedRows: 0,
        fields: [{ dataTypeID: 25, name: "case" }],
        rows: [{ case: "applied_exact" }],
      },
      { affectedRows: 0, fields: [], rows: [] },
    ]);

    await database.exec(`
      REVOKE EXECUTE ON FUNCTION renew_interrupted_password_confirmation(
        text,text,timestamptz
      ) FROM huayi_context_setter;
    `);
    assert.deepEqual(await database.exec(renderHostedMigration0014StatusSql()), [
      { affectedRows: 0, fields: [], rows: [] },
      {
        affectedRows: 0,
        fields: [{ dataTypeID: 25, name: "case" }],
        rows: [{ case: "uncertain" }],
      },
      { affectedRows: 0, fields: [], rows: [] },
    ]);
  } finally {
    await database.close();
  }
});

test("0014 status parser accepts only one exact bounded database verdict", () => {
  assert.equal(parseHostedMigration0014StatusOutput("applied_exact\n"), "applied_exact");
  assert.equal(parseHostedMigration0014StatusOutput("pending_exact\n"), "pending_exact");
  assert.equal(parseHostedMigration0014StatusOutput("uncertain\n"), "uncertain");
  for (const output of [
    "",
    "applied_exact",
    " applied_exact\n",
    "applied_exact\r\n",
    "applied_exact\npending_exact\n",
    "private-detail\n",
  ]) {
    assert.equal(parseHostedMigration0014StatusOutput(output), null);
  }
});

test("0014 status prints one fixed verdict for applied, pending, and uncertain", async () => {
  for (const { databaseStatus, expectedCode, expectedMessage } of [
    {
      databaseStatus: "applied_exact",
      expectedCode: 0,
      expectedMessage: hostedMigration0014StatusAppliedMessage,
    },
    {
      databaseStatus: "pending_exact",
      expectedCode: 0,
      expectedMessage: hostedMigration0014StatusPendingMessage,
    },
    {
      databaseStatus: "uncertain",
      expectedCode: 1,
      expectedMessage: hostedMigration0014StatusUncertainMessage,
    },
  ]) {
    const result = await runCli({ runStatusQuery: async () => databaseStatus });
    assert.deepEqual(result, {
      code: expectedCode,
      stderr: "",
      stdout: `${expectedMessage}\n`,
    });
  }
});

test("0014 status rejects arguments and inherited passwords before external work", async () => {
  for (const testCase of [
    { arguments_: [], environment: {} },
    { arguments_: [hostedMigration0014StatusArgument, "extra"], environment: {} },
    { arguments_: [hostedMigration0014StatusArgument], environment: { PGPASSWORD: "secret" } },
    {
      arguments_: [hostedMigration0014StatusArgument],
      environment: { SUPABASE_DB_PASSWORD: "secret" },
    },
  ]) {
    const calls = [];
    const privateFailure = async () => {
      calls.push("external");
      throw new Error("private-detail");
    };
    const result = await runCli({
      ...testCase,
      fetchCaCertificate: privateFailure,
      readPassword: privateFailure,
      runStatusQuery: privateFailure,
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(result, {
      code: 1,
      stderr: "",
      stdout: `${hostedMigration0014StatusUncertainMessage}\n`,
    });
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
});

test("0014 status uses official CA then hidden TTY and accepts 12-character administrator password", async () => {
  const calls = [];
  const result = await runCli({
    fetchCaCertificate: async () => {
      calls.push("official-ca");
      return caCertificate;
    },
    readPassword: async () => {
      calls.push("hidden-tty");
      return "123456789012";
    },
    runStatusQuery: async (secrets) => {
      calls.push("read-only-query");
      assert.deepEqual(secrets, {
        administratorPassword: "123456789012",
        caCertificate,
      });
      return "pending_exact";
    },
  });
  assert.deepEqual(calls, ["official-ca", "hidden-tty", "read-only-query"]);
  assert.equal(result.code, 0);

  let queryCalls = 0;
  const invalid = await runCli({
    readPassword: async () => "12345678901",
    runStatusQuery: async () => {
      queryCalls += 1;
      return "pending_exact";
    },
  });
  assert.equal(queryCalls, 0);
  assert.equal(invalid.code, 1);
});

test("0014 status query pins the known transaction pooler, verify-full CA, timeout, and read-only SQL", async () => {
  let observed;
  const result = await runHostedMigration0014StatusQuery(
    {
      administratorPassword: "fictional-administrator-password",
      caCertificate,
    },
    {
      runPsql: async (options) => {
        observed = options;
        return { code: 0, stderr: "", stdout: "applied_exact\n" };
      },
    },
  );
  assert.equal(result, "applied_exact");
  assert.equal(
    observed.databaseUrl,
    "postgresql://postgres.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
  );
  assert.deepEqual(observed.environment, {
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
  });
  assert.equal(observed.password, "fictional-administrator-password");
  assert.equal(observed.captureOutput, true);
  assert.equal(observed.timeoutMilliseconds, 30_000);
  assert.equal(observed.input, renderHostedMigration0014StatusSql());

  const failed = await runHostedMigration0014StatusQuery(
    {
      administratorPassword: "fictional-administrator-password",
      caCertificate,
    },
    {
      runPsql: async () => ({
        code: 1,
        stderr: "private-process-error",
        stdout: "applied_exact\nprivate-database-output\n",
      }),
    },
  );
  assert.equal(failed, null);
});

test("0014 status fails closed without reflecting CA, password, query, or process detail", async () => {
  for (const overrides of [
    { fetchCaCertificate: async () => Promise.reject(new Error("private-ca")) },
    { readPassword: async () => Promise.reject(new Error("private-password")) },
    { runStatusQuery: async () => Promise.reject(new Error("private-query")) },
    { runStatusQuery: async () => null },
  ]) {
    const result = await runCli(overrides);
    assert.deepEqual(result, {
      code: 1,
      stderr: "",
      stdout: `${hostedMigration0014StatusUncertainMessage}\n`,
    });
    assert.equal(JSON.stringify(result).includes("private-"), false);
  }
});

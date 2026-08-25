import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  hostedMigration0015StatusAppliedMessage,
  hostedMigration0015StatusArgument,
  hostedMigration0015StatusPendingMessage,
  hostedMigration0015StatusUncertainMessage,
  parseHostedMigration0015StatusOutput,
  renderHostedMigration0015StatusSql,
  runHostedMigration0015StatusCli,
  runHostedMigration0015StatusQuery,
} from "./acceptance-hosted-migration-0015-status.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");
const baselineUrl = new URL("../apps/api/migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const otpResendUrl = new URL(
  "../apps/api/migrations/0014-password-signup-otp-resend.sql",
  import.meta.url,
);
const aclHardeningUrl = new URL(
  "../apps/api/migrations/0015-public-function-acl-hardening.sql",
  import.meta.url,
);
const versionsThrough0014 = [
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
  "20260824010000",
];

async function createPendingDatabase() {
  const database = new PGlite();
  await database.waitReady;
  await database.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
  `);
  await database.exec(await readFile(baselineUrl, "utf8"));
  await database.exec(await readFile(otpResendUrl, "utf8"));
  await database.exec(`
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
    INSERT INTO supabase_migrations.schema_migrations(version)
    VALUES ${versionsThrough0014.map((version) => `('${version}')`).join(",")};
  `);
  return database;
}

async function readVerdict(database) {
  const result = await database.exec(renderHostedMigration0015StatusSql());
  return result[1]?.rows[0]?.case;
}

async function runCli(overrides = {}) {
  let stderr = "";
  let stdout = "";
  const code = await runHostedMigration0015StatusCli({
    arguments_: [hostedMigration0015StatusArgument],
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

test("package exposes one fixed 0015 read-only status entrypoint", async () => {
  const packageDocument = JSON.parse(
    await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url)),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:migration:0015:status"],
    `node scripts/acceptance-hosted-migration-0015-status.mjs ${hostedMigration0015StatusArgument}`,
  );
  assert.equal(
    hostedMigration0015StatusArgument,
    "--status-20260825010000-public-function-acl-hardening-kpadiulxkgckskcfydry",
  );
});

test("0015 status SQL pins chain, external ACL, default ACL, and 0014 preservation", () => {
  const sql = renderHostedMigration0015StatusSql();
  assert.match(sql, /^\nBEGIN READ ONLY;/u);
  assert.match(sql, /20260824010000/u);
  assert.match(sql, /20260825010000/u);
  assert.match(sql, /anon/u);
  assert.match(sql, /authenticated/u);
  assert.match(sql, /service_role/u);
  assert.match(sql, /pg_default_acl/u);
  assert.match(sql, /defaclnamespace = 0/u);
  assert.match(sql, /namespace\.nspname = 'public'/u);
  assert.match(sql, /bind_auth_identity\(text,uuid\)/u);
  assert.match(sql, /renew_interrupted_password_confirmation\(text,text,timestamptz\)/u);
  assert.match(sql, /huayi_context_setter/u);
  assert.match(sql, /huayi_business/u);
  assert.match(sql, /huayi_runtime/u);
  assert.match(sql, /'applied_exact'/u);
  assert.match(sql, /'pending_exact'/u);
  assert.match(sql, /ELSE 'uncertain'/u);
  assert.match(sql, /ROLLBACK;\n$/u);
});

test("0015 status classifies exact pending and exact applied catalogs", async () => {
  const database = await createPendingDatabase();
  try {
    assert.equal(await readVerdict(database), "pending_exact");

    await database.exec(await readFile(aclHardeningUrl, "utf8"));
    await database.exec(`
      INSERT INTO supabase_migrations.schema_migrations(version)
      VALUES ('20260825010000');
    `);
    assert.equal(await readVerdict(database), "applied_exact");
  } finally {
    await database.close();
  }
});

test("0015 status fails uncertain on ACL, default ACL, role, or 0014 grant drift", async () => {
  const mutations = [
    `GRANT EXECUTE ON FUNCTION bind_auth_identity(text,uuid) TO anon;`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
       GRANT EXECUTE ON FUNCTIONS TO authenticated;`,
    `REVOKE EXECUTE ON FUNCTION renew_interrupted_password_confirmation(
       text,text,timestamptz
     ) FROM huayi_context_setter;`,
    `DROP ROLE service_role;`,
  ];
  for (const mutation of mutations) {
    const database = await createPendingDatabase();
    try {
      await database.exec(await readFile(aclHardeningUrl, "utf8"));
      await database.exec(`
        INSERT INTO supabase_migrations.schema_migrations(version)
        VALUES ('20260825010000');
      `);
      await database.exec(mutation);
      assert.equal(await readVerdict(database), "uncertain");
    } finally {
      await database.close();
    }
  }
});

test("0015 status parser accepts only one exact bounded verdict", () => {
  assert.equal(parseHostedMigration0015StatusOutput("applied_exact\n"), "applied_exact");
  assert.equal(parseHostedMigration0015StatusOutput("pending_exact\n"), "pending_exact");
  assert.equal(parseHostedMigration0015StatusOutput("uncertain\n"), "uncertain");
  for (const output of [
    "",
    "applied_exact",
    " applied_exact\n",
    "applied_exact\r\n",
    "applied_exact\npending_exact\n",
    "private-detail\n",
  ]) {
    assert.equal(parseHostedMigration0015StatusOutput(output), null);
  }
});

test("0015 status CLI emits only fixed verdicts", async () => {
  for (const { databaseStatus, expectedCode, expectedMessage } of [
    {
      databaseStatus: "applied_exact",
      expectedCode: 0,
      expectedMessage: hostedMigration0015StatusAppliedMessage,
    },
    {
      databaseStatus: "pending_exact",
      expectedCode: 0,
      expectedMessage: hostedMigration0015StatusPendingMessage,
    },
    {
      databaseStatus: "uncertain",
      expectedCode: 1,
      expectedMessage: hostedMigration0015StatusUncertainMessage,
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

test("0015 status rejects arguments and inherited passwords before external work", async () => {
  for (const testCase of [
    { arguments_: [], environment: {} },
    { arguments_: [hostedMigration0015StatusArgument, "extra"], environment: {} },
    { arguments_: [hostedMigration0015StatusArgument], environment: { PGPASSWORD: "secret" } },
    {
      arguments_: [hostedMigration0015StatusArgument],
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
      stdout: `${hostedMigration0015StatusUncertainMessage}\n`,
    });
  }
});

test("0015 status query pins transaction pooler, verify-full CA, timeout, and read-only SQL", async () => {
  let observed;
  const result = await runHostedMigration0015StatusQuery(
    { administratorPassword: "fictional-administrator-password", caCertificate },
    {
      runPsql: async (options) => {
        observed = options;
        return { code: 0, stderr: "", stdout: "applied_exact\n" };
      },
    },
  );
  assert.equal(result, "applied_exact");
  assert.match(observed.databaseUrl, /:6543\/postgres\?sslmode=verify-full$/u);
  assert.deepEqual(observed.environment, {
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    PGPASSWORD: "fictional-administrator-password",
  });
  assert.equal(observed.captureOutput, true);
  assert.equal(observed.timeoutMilliseconds, 30_000);
  assert.equal(observed.input, renderHostedMigration0015StatusSql());
});

test("0015 status hides all external failures", async () => {
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
      stdout: `${hostedMigration0015StatusUncertainMessage}\n`,
    });
    assert.equal(JSON.stringify(result).includes("private-"), false);
  }
});

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import test from "node:test";

import {
  hostedMigration0014ApplyArgument,
  hostedMigration0014ApplySuccessMessage,
  parseHostedMigration0014PostflightOutput,
  renderHostedMigration0014PostflightSql,
  runHostedMigration0014ApplyCli,
  runHostedMigration0014ApplyProcess,
  verifyHostedMigration0014RepositoryIdentity,
} from "./acceptance-hosted-migration-0014-apply.mjs";
import {
  hostedMigration0014DryRunArgument,
  hostedMigration0014Filename,
} from "./acceptance-hosted-migration-0014-dry-run.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const validDryRunOutput = `DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260824010000_password_signup_otp_resend.sql
Finished supabase db push.
`;

function createChild() {
  const child = new EventEmitter();
  child.kill = () => true;
  return child;
}

function createDependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    dependencies: {
      fetchCaCertificate: async () => {
        calls.push("fetch-ca");
        return caCertificate;
      },
      readPassword: async () => {
        calls.push("password");
        return "fictional-administrator-password";
      },
      runApply: async (secrets) => {
        calls.push("apply");
        assert.deepEqual(secrets, {
          administratorPassword: "fictional-administrator-password",
          caCertificate,
        });
        return { code: 0 };
      },
      runDryRun: async (secrets) => {
        calls.push("dry-run");
        assert.deepEqual(secrets, {
          administratorPassword: "fictional-administrator-password",
          caCertificate,
        });
        return { code: 0, stderr: validDryRunOutput, stdout: "" };
      },
      runPostflight: async (secrets) => {
        calls.push("postflight");
        assert.deepEqual(secrets, {
          administratorPassword: "fictional-administrator-password",
          caCertificate,
        });
        return true;
      },
      runPreflight: async () => {
        calls.push("preflight");
        return true;
      },
      ...overrides,
    },
  };
}

async function runCli(overrides = {}) {
  let stderr = "";
  let stdout = "";
  const result = await runHostedMigration0014ApplyCli({
    arguments_: [hostedMigration0014ApplyArgument],
    environment: {},
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
    ...overrides,
  });
  return { code: result, stderr, stdout };
}

test("package exposes one exact 0014 apply entrypoint separate from dry-run", async () => {
  const packageDocument = JSON.parse(
    await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url)),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:migration:0014:apply"],
    `node scripts/acceptance-hosted-migration-0014-apply.mjs ${hostedMigration0014ApplyArgument}`,
  );
  assert.notEqual(hostedMigration0014ApplyArgument, hostedMigration0014DryRunArgument);
  assert.equal(hostedMigration0014Filename, "20260824010000_password_signup_otp_resend.sql");
  assert.match(
    hostedMigration0014ApplySuccessMessage,
    new RegExp(hostedMigration0014Filename, "u"),
  );
});

test("0014 apply rejects arguments and inherited passwords before every dependency", async () => {
  for (const testCase of [
    { arguments_: [], environment: {} },
    { arguments_: [hostedMigration0014DryRunArgument], environment: {} },
    { arguments_: [hostedMigration0014ApplyArgument], environment: { PGPASSWORD: "secret" } },
    {
      arguments_: [hostedMigration0014ApplyArgument],
      environment: { SUPABASE_DB_PASSWORD: "secret" },
    },
  ]) {
    let dependencies = 0;
    const closed = async () => {
      dependencies += 1;
      return true;
    };
    const result = await runCli({
      ...testCase,
      fetchCaCertificate: closed,
      readPassword: closed,
      runApply: closed,
      runDryRun: closed,
      runPostflight: closed,
      runPreflight: closed,
    });
    assert.equal(result.code, 1);
    assert.equal(dependencies, 0);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Hosted 0014 migration apply did not produce verified completion; do not retry until remote state is checked.\n",
    );
    assert.equal(result.stderr.includes("secret"), false);
  }
});

test("0014 apply requires local pre-backup and rebuild evidence before reading a secret", async () => {
  let secretOperations = 0;
  const result = await runCli({
    fetchCaCertificate: async () => {
      secretOperations += 1;
      return caCertificate;
    },
    readPassword: async () => {
      secretOperations += 1;
      return "fictional";
    },
    runApply: async () => {
      secretOperations += 1;
      return { code: 0 };
    },
    runDryRun: async () => {
      secretOperations += 1;
      return { code: 0, stdout: validDryRunOutput };
    },
    runPostflight: async () => {
      secretOperations += 1;
      return true;
    },
    runPreflight: async () => false,
  });
  assert.equal(result.code, 1);
  assert.equal(secretOperations, 0);
  assert.equal(result.stdout, "");
});

test("0014 apply orders preflight, exact dry-run, mutation, and postflight", async () => {
  const { calls, dependencies } = createDependencies();
  const result = await runCli(dependencies);
  assert.deepEqual(calls, [
    "preflight",
    "fetch-ca",
    "password",
    "dry-run",
    "preflight",
    "apply",
    "postflight",
  ]);
  assert.deepEqual(result, {
    code: 0,
    stderr: "",
    stdout: `${hostedMigration0014ApplySuccessMessage}\n`,
  });
});

test("0014 apply accepts the exact mutation preflight transcript from stderr only", async () => {
  const { dependencies } = createDependencies({
    runDryRun: async () => ({ code: 0, stderr: validDryRunOutput, stdout: "" }),
  });
  const result = await runCli(dependencies);

  assert.deepEqual(result, {
    code: 0,
    stderr: "",
    stdout: `${hostedMigration0014ApplySuccessMessage}\n`,
  });
});

test("0014 apply rechecks candidate evidence and migration identity immediately before mutation", async () => {
  let preflightCalls = 0;
  let applyCalls = 0;
  const result = await runCli({
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => "fictional-administrator-password",
    runApply: async () => {
      applyCalls += 1;
      return { code: 0 };
    },
    runDryRun: async () => ({ code: 0, stderr: validDryRunOutput, stdout: "" }),
    runPostflight: async () => true,
    runPreflight: async () => {
      preflightCalls += 1;
      return preflightCalls === 1;
    },
  });
  assert.equal(result.code, 1);
  assert.equal(preflightCalls, 2);
  assert.equal(applyCalls, 0);
  assert.equal(result.stdout, "");
});

test("0014 repository identity pins byte-identical API and Supabase migration mirrors", async () => {
  await assert.doesNotReject(verifyHostedMigration0014RepositoryIdentity());
  const reads = [];
  await assert.rejects(
    verifyHostedMigration0014RepositoryIdentity({
      readMigrationFile: async (path) => {
        reads.push(path);
        return reads.length === 1 ? Buffer.from("fictional-one") : Buffer.from("fictional-two");
      },
    }),
    /Hosted 0014 migration repository identity is invalid\./u,
  );
  assert.equal(reads.length, 2);
  assert.match(reads[0], /supabase\/migrations\/20260824010000_password_signup_otp_resend\.sql$/u);
  assert.match(reads[1], /apps\/api\/migrations\/0014-password-signup-otp-resend\.sql$/u);
});

test("0014 apply never mutates unless the same operation dry-runs exactly one 0014", async () => {
  for (const dryRunResult of [
    { code: 1, stderr: validDryRunOutput, stdout: "" },
    { code: 0, stderr: validDryRunOutput, stdout: "unexpected" },
    {
      code: 0,
      stderr: validDryRunOutput.replace(hostedMigration0014Filename, "extra.sql"),
      stdout: "",
    },
  ]) {
    const calls = [];
    const result = await runCli({
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runApply: async () => {
        calls.push("apply");
        return { code: 0 };
      },
      runDryRun: async () => dryRunResult,
      runPostflight: async () => {
        calls.push("postflight");
        return true;
      },
      runPreflight: async () => true,
    });
    assert.equal(result.code, 1);
    assert.deepEqual(calls, []);
    assert.equal(result.stdout, "");
  }
});

test("0014 apply requires both a successful child and exact read-only postflight", async () => {
  for (const testCase of [
    { applyCode: 1, expectedPostflightCalls: 0, postflight: true },
    { applyCode: 0, expectedPostflightCalls: 1, postflight: false },
  ]) {
    let postflightCalls = 0;
    const result = await runCli({
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runApply: async () => ({ code: testCase.applyCode }),
      runDryRun: async () => ({ code: 0, stderr: validDryRunOutput, stdout: "" }),
      runPostflight: async () => {
        postflightCalls += 1;
        return testCase.postflight;
      },
      runPreflight: async () => true,
    });
    assert.equal(result.code, 1);
    assert.equal(postflightCalls, testCase.expectedPostflightCalls);
    assert.equal(result.stdout, "");
  }
});

test("0014 apply process pins --yes, verify-full, and removes its public CA", async () => {
  const child = createChild();
  let observed;
  const resultPromise = runHostedMigration0014ApplyProcess(
    { administratorPassword: "fictional-secret", caCertificate },
    {
      spawnProcess(command, arguments_, options) {
        observed = { arguments_, command, options };
        return child;
      },
    },
  );
  while (observed === undefined) await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.match(observed.command, /\/node_modules\/\.bin\/supabase$/u);
  assert.deepEqual(observed.arguments_, [
    "db",
    "push",
    "--yes",
    "--skip-vault",
    "--db-url",
    "postgresql://postgres.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
  ]);
  assert.deepEqual(Object.keys(observed.options.env).sort(), [
    "LANG",
    "LC_ALL",
    "PGPASSWORD",
    "PGSSLMODE",
    "PGSSLROOTCERT",
  ]);
  assert.equal(observed.options.env.PGPASSWORD, "fictional-secret");
  assert.equal(observed.options.env.PGSSLMODE, "verify-full");
  assert.equal(observed.options.shell, false);
  assert.deepEqual(observed.options.stdio, ["ignore", "ignore", "ignore"]);
  const caPath = observed.options.env.PGSSLROOTCERT;
  assert.equal((await stat(caPath)).mode & 0o777, 0o600);
  child.emit("close", 0, null);
  assert.deepEqual(await resultPromise, { code: 0 });
  await assert.rejects(stat(caPath), { code: "ENOENT" });
  assert.equal(JSON.stringify(observed.arguments_).includes("fictional-secret"), false);
});

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

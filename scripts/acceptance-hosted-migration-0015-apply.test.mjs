import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  hostedMigration0015ApplyArgument,
  hostedMigration0015ApplySuccessMessage,
  runHostedMigration0015ApplyCli,
  runHostedMigration0015ApplyProcess,
  runHostedMigration0015Postflight,
  verifyHostedMigration0015RepositoryIdentity,
} from "./acceptance-hosted-migration-0015-apply.mjs";
import {
  hostedMigration0015DryRunArgument,
  hostedMigration0015Filename,
} from "./acceptance-hosted-migration-0015-dry-run.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const validDryRunOutput = `DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260825010000_public_function_acl_hardening.sql
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
      runApply: async () => {
        calls.push("apply");
        return { code: 0 };
      },
      runDryRun: async () => {
        calls.push("dry-run");
        return { code: 0, stderr: validDryRunOutput, stdout: "" };
      },
      runPostflight: async () => {
        calls.push("postflight");
        return true;
      },
      runPreflight: async () => {
        calls.push("preflight");
        return true;
      },
      runStatus: async (secrets) => {
        calls.push("status");
        assert.deepEqual(secrets, {
          administratorPassword: "fictional-administrator-password",
          caCertificate,
        });
        return "pending_exact";
      },
      ...overrides,
    },
  };
}

async function runCli(overrides = {}) {
  let stderr = "";
  let stdout = "";
  const code = await runHostedMigration0015ApplyCli({
    arguments_: [hostedMigration0015ApplyArgument],
    environment: {},
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

test("package exposes one exact 0015 apply entrypoint separate from dry-run", async () => {
  const packageDocument = JSON.parse(
    await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url)),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:migration:0015:apply"],
    `node scripts/acceptance-hosted-migration-0015-apply.mjs ${hostedMigration0015ApplyArgument}`,
  );
  assert.equal(
    hostedMigration0015ApplyArgument,
    "--confirm-apply-20260825010000-public-function-acl-hardening-kpadiulxkgckskcfydry",
  );
  assert.notEqual(hostedMigration0015ApplyArgument, hostedMigration0015DryRunArgument);
  assert.match(
    hostedMigration0015ApplySuccessMessage,
    new RegExp(hostedMigration0015Filename, "u"),
  );
});

test("0015 apply rejects arguments and inherited passwords before every dependency", async () => {
  for (const testCase of [
    { arguments_: [], environment: {} },
    { arguments_: [hostedMigration0015DryRunArgument], environment: {} },
    { arguments_: [hostedMigration0015ApplyArgument], environment: { PGPASSWORD: "secret" } },
    {
      arguments_: [hostedMigration0015ApplyArgument],
      environment: { SUPABASE_DB_PASSWORD: "secret" },
    },
  ]) {
    let dependencyCalls = 0;
    const dependency = async () => {
      dependencyCalls += 1;
      return true;
    };
    const result = await runCli({
      ...testCase,
      fetchCaCertificate: dependency,
      readPassword: dependency,
      runApply: dependency,
      runDryRun: dependency,
      runPostflight: dependency,
      runPreflight: dependency,
      runStatus: dependency,
    });
    assert.equal(dependencyCalls, 0);
    assert.deepEqual(result, {
      code: 1,
      stderr:
        "Hosted 0015 migration apply did not produce verified completion; do not retry until remote state is checked.\n",
      stdout: "",
    });
  }
});

test("0015 apply requires Phase 91 pre and rebuild evidence before reading secrets", async () => {
  let secretCalls = 0;
  const result = await runCli({
    fetchCaCertificate: async () => {
      secretCalls += 1;
    },
    readPassword: async () => {
      secretCalls += 1;
    },
    runApply: async () => {
      secretCalls += 1;
    },
    runDryRun: async () => {
      secretCalls += 1;
    },
    runPostflight: async () => {
      secretCalls += 1;
    },
    runPreflight: async () => false,
  });
  assert.equal(result.code, 1);
  assert.equal(secretCalls, 0);
});

test("0015 apply orders preflight, dry-run, immediate evidence and status rechecks, mutation, and postflight", async () => {
  const { calls, dependencies } = createDependencies();
  const result = await runCli(dependencies);
  assert.deepEqual(calls, [
    "preflight",
    "fetch-ca",
    "password",
    "dry-run",
    "preflight",
    "status",
    "apply",
    "postflight",
  ]);
  assert.deepEqual(result, {
    code: 0,
    stderr: "",
    stdout: `${hostedMigration0015ApplySuccessMessage}\n`,
  });
});

test("0015 apply never mutates unless the immediate remote status is pending exact", async () => {
  for (const status of ["applied_exact", "uncertain", null]) {
    let applyCalls = 0;
    let postflightCalls = 0;
    const result = await runCli({
      ...createDependencies().dependencies,
      runApply: async () => {
        applyCalls += 1;
        return { code: 0 };
      },
      runPostflight: async () => {
        postflightCalls += 1;
        return true;
      },
      runStatus: async () => status,
    });
    assert.equal(result.code, 1);
    assert.equal(applyCalls, 0);
    assert.equal(postflightCalls, 0);
  }

  let applyCalls = 0;
  const result = await runCli({
    ...createDependencies().dependencies,
    runApply: async () => {
      applyCalls += 1;
      return { code: 0 };
    },
    runStatus: async () => {
      throw new Error("private remote status failure");
    },
  });
  assert.equal(result.code, 1);
  assert.equal(applyCalls, 0);
  assert.doesNotMatch(result.stderr, /private|remote status/u);
});

test("0015 apply never mutates on inexact dry-run or stale immediate preflight", async () => {
  for (const { dryRun, preflightResults } of [
    {
      dryRun: { code: 1, stderr: validDryRunOutput, stdout: "" },
      preflightResults: [true],
    },
    {
      dryRun: { code: 0, stderr: validDryRunOutput, stdout: "unexpected" },
      preflightResults: [true],
    },
    {
      dryRun: { code: 0, stderr: validDryRunOutput, stdout: "" },
      preflightResults: [true, false],
    },
  ]) {
    let applyCalls = 0;
    let preflightCalls = 0;
    const result = await runCli({
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runApply: async () => {
        applyCalls += 1;
        return { code: 0 };
      },
      runDryRun: async () => dryRun,
      runPostflight: async () => true,
      runPreflight: async () => preflightResults[preflightCalls++],
    });
    assert.equal(result.code, 1);
    assert.equal(applyCalls, 0);
  }
});

test("0015 repository identity pins byte-identical migration mirrors and exact hash", async () => {
  await assert.doesNotReject(verifyHostedMigration0015RepositoryIdentity());
  const reads = [];
  await assert.rejects(
    verifyHostedMigration0015RepositoryIdentity({
      readMigrationFile: async (path) => {
        reads.push(path);
        return reads.length === 1 ? Buffer.from("fictional-one") : Buffer.from("fictional-two");
      },
    }),
    /Hosted 0015 migration repository identity is invalid/u,
  );
  assert.match(
    reads[0],
    /supabase[\\/]migrations[\\/]20260825010000_public_function_acl_hardening\.sql$/u,
  );
  assert.match(
    reads[1],
    /apps[\\/]api[\\/]migrations[\\/]0015-public-function-acl-hardening\.sql$/u,
  );
});

test("0015 apply process pins --yes, verify-full, no output, and removes CA", async () => {
  const child = createChild();
  let observed;
  const resultPromise = runHostedMigration0015ApplyProcess(
    { administratorPassword: "fictional-secret", caCertificate },
    {
      spawnProcess(command, arguments_, options) {
        observed = { arguments_, command, options };
        return child;
      },
    },
  );
  while (observed === undefined) await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.deepEqual(observed.arguments_, [
    "db",
    "push",
    "--yes",
    "--skip-vault",
    "--db-url",
    "postgresql://postgres.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
  ]);
  assert.equal(observed.options.env.PGSSLMODE, "verify-full");
  assert.equal(observed.options.env.PGPASSWORD, undefined);
  const passwordPath = observed.options.env.PGPASSFILE;
  assert.equal((await stat(passwordPath)).mode & 0o777, 0o600);
  assert.equal(
    await readFile(passwordPath, "utf8"),
    "aws-0-ap-southeast-1.pooler.supabase.com:6543:postgres:postgres.kpadiulxkgckskcfydry:fictional-secret\n",
  );
  assert.deepEqual(observed.options.stdio, ["ignore", "ignore", "ignore"]);
  const caPath = observed.options.env.PGSSLROOTCERT;
  if (process.platform !== "win32") assert.equal((await stat(caPath)).mode & 0o777, 0o600);
  child.emit("close", 0, null);
  assert.deepEqual(await resultPromise, { code: 0 });
  await assert.rejects(stat(caPath), { code: "ENOENT" });
  await assert.rejects(stat(passwordPath), { code: "ENOENT" });
});

test("0015 postflight accepts only the exact applied read-only status", async () => {
  const calls = [];
  assert.equal(
    await runHostedMigration0015Postflight(
      { administratorPassword: "fictional", caCertificate },
      {
        runStatusQuery: async (secrets) => {
          calls.push(secrets);
          return "applied_exact";
        },
      },
    ),
    true,
  );
  assert.deepEqual(calls, [{ administratorPassword: "fictional", caCertificate }]);
  for (const status of ["pending_exact", "uncertain", null]) {
    assert.equal(
      await runHostedMigration0015Postflight(
        { administratorPassword: "fictional", caCertificate },
        { runStatusQuery: async () => status },
      ),
      false,
    );
  }
});

test("0015 apply requires successful mutation and exact postflight without reflecting failures", async () => {
  for (const { applyCode, postflight } of [
    { applyCode: 1, postflight: true },
    { applyCode: 0, postflight: false },
  ]) {
    const { dependencies } = createDependencies({
      runApply: async () => ({ code: applyCode }),
      runPostflight: async () => postflight,
    });
    const result = await runCli(dependencies);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /private|fictional/u);
  }
});

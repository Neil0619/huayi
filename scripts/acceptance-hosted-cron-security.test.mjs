import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHostedCron,
  hostedCronApplyConfirmation,
  hostedCronStatusArgument,
  readHostedCronStatus,
  verifyHostedCronRepositoryCandidate,
} from "./acceptance-hosted-cron.mjs";
import {
  applyDependencies,
  operationsSql,
  postgresPassword,
  rootCertificate,
  safeEnvironment,
  statusOutput,
} from "./acceptance-hosted-cron-test-fixtures.mjs";

test("hosted Cron status fetches official CA before hidden password", async () => {
  const calls = [];
  await readHostedCronStatus({
    arguments_: ["status", hostedCronStatusArgument],
    environment: safeEnvironment,
    fetchCaCertificate: async () => {
      calls.push("ca");
      return rootCertificate;
    },
    readPassword: async () => {
      calls.push("password");
      return postgresPassword;
    },
    runPsql: async () => {
      calls.push("database");
      return { code: 0, stdout: statusOutput() };
    },
  });
  assert.deepEqual(calls, ["ca", "password", "database"]);
});

test("hosted Cron rejects inherited passwords and invalid hidden passwords before database work", async () => {
  for (const testCase of [
    { environment: { PGPASSWORD: "secret" } },
    { environment: { SUPABASE_DB_PASSWORD: "secret" } },
    { environment: {}, password: "short" },
    { environment: {}, password: "a".repeat(513) },
    { environment: {}, password: "valid-prefix\0suffix" },
    { environment: {}, password: "valid-prefix\rsuffix" },
    { environment: {}, password: "valid-prefix\nsuffix" },
  ]) {
    const calls = [];
    await assert.rejects(
      readHostedCronStatus({
        arguments_: ["status", hostedCronStatusArgument],
        environment: testCase.environment,
        fetchCaCertificate: async () => {
          calls.push("ca");
          return rootCertificate;
        },
        readPassword: async () => {
          calls.push("password");
          return testCase.password ?? postgresPassword;
        },
        runPsql: async () => {
          calls.push("database");
          return { code: 0, stdout: statusOutput() };
        },
      }),
      /Hosted Supabase Cron status failed/u,
    );
    assert.equal(calls.includes("database"), false);
    if (Object.keys(testCase.environment).length > 0) assert.deepEqual(calls, []);
  }
});

test("hosted Cron repository candidate requires exact upstream HEAD and a clean worktree", async () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const responses = new Map([
    ["rev-parse --verify HEAD", { code: 0, stdout: `${commit}\n` }],
    ["rev-parse --verify @{upstream}", { code: 0, stdout: `${commit}\n` }],
    ["status --porcelain=v1 --untracked-files=normal", { code: 0, stdout: "" }],
  ]);
  await assert.doesNotReject(
    verifyHostedCronRepositoryCandidate({
      runGit: async (arguments_) => responses.get(arguments_.join(" ")),
    }),
  );

  for (const override of [
    ["rev-parse --verify @{upstream}", { code: 0, stdout: `${"f".repeat(40)}\n` }],
    ["status --porcelain=v1 --untracked-files=normal", { code: 0, stdout: " M private\n" }],
  ]) {
    await assert.rejects(
      verifyHostedCronRepositoryCandidate({
        runGit: async (arguments_) => {
          const key = arguments_.join(" ");
          return key === override[0] ? override[1] : responses.get(key);
        },
      }),
      /repository-candidate/u,
    );
  }
});

test("apply rejects inherited passwords before source, candidate, secrets, or database work", async () => {
  for (const environment of [{ PGPASSWORD: "secret" }, { SUPABASE_DB_PASSWORD: "secret" }]) {
    const calls = [];
    const external = async () => {
      calls.push("external");
      return true;
    };
    await assert.rejects(
      applyHostedCron({
        arguments_: ["apply", hostedCronApplyConfirmation],
        environment,
        fetchCaCertificate: external,
        loadOperationsSql: external,
        readPassword: external,
        runPsql: external,
        verifyRepositoryCandidate: external,
      }),
      /credentials/u,
    );
    assert.deepEqual(calls, []);
  }
});

test("apply validates exact reviewed operations SQL before any database call", async () => {
  for (const invalidSql of [
    "BEGIN; SELECT 1; COMMIT;\n",
    operationsSql.replace("BEGIN;", "BEGIN;\n\\i private.sql"),
    operationsSql.replace("BEGIN;", "BEGIN;\nDROP TABLE public.user_profiles;"),
  ]) {
    let calls = 0;
    await assert.rejects(
      applyHostedCron({
        arguments_: ["apply", hostedCronApplyConfirmation],
        environment: safeEnvironment,
        ...applyDependencies,
        loadOperationsSql: async () => invalidSql,
        runPsql: async () => {
          calls += 1;
          return { code: 0, stdout: statusOutput() };
        },
      }),
      /operations-contract/u,
    );
    assert.equal(calls, 0);
  }
});

test("apply rejects an unreviewed repository candidate before secrets or database work", async () => {
  const calls = [];
  await assert.rejects(
    applyHostedCron({
      arguments_: ["apply", hostedCronApplyConfirmation],
      environment: safeEnvironment,
      fetchCaCertificate: async () => {
        calls.push("ca");
        return rootCertificate;
      },
      loadOperationsSql: async () => operationsSql,
      readPassword: async () => {
        calls.push("password");
        return postgresPassword;
      },
      runPsql: async () => {
        calls.push("database");
        return { code: 0, stdout: statusOutput() };
      },
      verifyRepositoryCandidate: async () => false,
    }),
    /repository-candidate/u,
  );
  assert.deepEqual(calls, []);
});

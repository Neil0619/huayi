import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedDeepseekMigrationApplyArgument,
  hostedDeepseekMigrationApplySuccessMessage,
  runHostedDeepseekMigrationApplyCli,
  runHostedDeepseekMigrationPreflight,
  verifyHostedDeepseekMigrationRepositoryIdentity,
} from "./acceptance-hosted-deepseek-migration-apply.mjs";
import {
  hasExactHostedDeepseekMigrationDryRunTranscript,
  hostedDeepseekMigrationDryRunArgument,
  hostedDeepseekMigrationFilenames,
  runHostedDeepseekMigrationDryRunCli,
} from "./acceptance-hosted-deepseek-migration-dry-run.mjs";
import {
  hostedAcceptanceMigrationVersionsThrough0021,
  hostedAcceptanceMigrationVersionsThrough0015,
} from "./acceptance-hosted-foundation.mjs";
import { hostedDeepseekMigrationArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import {
  hostedDeepseekMigrationStatusArgument,
  runHostedDeepseekMigrationStatusCli,
} from "./acceptance-hosted-deepseek-migration-status.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const validDryRunOutput = `DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
${hostedDeepseekMigrationFilenames.map((filename) => ` • ${filename}`).join("\n")}
Finished supabase db push.
`;

test("current Hosted canonical chain advances to 0021 without changing historical 0015", () => {
  assert.equal(hostedAcceptanceMigrationVersionsThrough0015.length, 15);
  assert.equal(hostedAcceptanceMigrationVersionsThrough0015.at(-1), "20260825010000");
  assert.equal(hostedAcceptanceMigrationVersionsThrough0021.length, 21);
  assert.equal(hostedAcceptanceMigrationVersionsThrough0021.at(-1), "20260827060000");
  assert.deepEqual(
    hostedDeepseekMigrationArtifactContract.migrationVersions,
    hostedAcceptanceMigrationVersionsThrough0021,
  );
});

test("DeepSeek migration commands pin one six-file 0016-0021 surface", async () => {
  assert.deepEqual(hostedDeepseekMigrationFilenames, [
    "20260827010000_hosted_deepseek_acceptance_authority.sql",
    "20260827020000_hosted_deepseek_acceptance_retention_scrub.sql",
    "20260827030000_hosted_deepseek_acceptance_status.sql",
    "20260827040000_hosted_deepseek_acceptance_effective_fuse.sql",
    "20260827050000_hosted_deepseek_acceptance_authority_mutations.sql",
    "20260827060000_hosted_deepseek_acceptance_evidence.sql",
  ]);
  assert.notEqual(hostedDeepseekMigrationDryRunArgument, hostedDeepseekMigrationApplyArgument);
  assert.match(hostedDeepseekMigrationStatusArgument, /0016-0021/u);
  assert.match(hostedDeepseekMigrationApplySuccessMessage, /0016-0021/u);

  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  for (const [operation, module, argument] of [
    ["status", "status", hostedDeepseekMigrationStatusArgument],
    ["dry-run", "dry-run", hostedDeepseekMigrationDryRunArgument],
    ["apply", "apply", hostedDeepseekMigrationApplyArgument],
  ]) {
    assert.equal(
      packageDocument.scripts[`acceptance:hosted:deepseek:migration:${operation}`],
      `node scripts/acceptance-hosted-deepseek-migration-${module}.mjs ${argument}`,
    );
  }
});

test("DeepSeek migration dry-run accepts only the exact six-file transcript", () => {
  assert.equal(
    hasExactHostedDeepseekMigrationDryRunTranscript({ stderr: validDryRunOutput, stdout: "" }),
    true,
  );
  for (const transcript of [
    validDryRunOutput.replace(` • ${hostedDeepseekMigrationFilenames[0]}\n`, ""),
    validDryRunOutput.replace(hostedDeepseekMigrationFilenames[5], "unexpected.sql"),
    `${validDryRunOutput}private-detail\n`,
    validDryRunOutput.replace(
      ` • ${hostedDeepseekMigrationFilenames[0]}\n • ${hostedDeepseekMigrationFilenames[1]}`,
      ` • ${hostedDeepseekMigrationFilenames[1]}\n • ${hostedDeepseekMigrationFilenames[0]}`,
    ),
  ]) {
    assert.equal(
      hasExactHostedDeepseekMigrationDryRunTranscript({ stderr: transcript, stdout: "" }),
      false,
    );
  }
});

test("DeepSeek migration apply orders both local gates around the read-only remote check", async () => {
  const calls = [];
  let stdout = "";
  const code = await runHostedDeepseekMigrationApplyCli({
    arguments_: [hostedDeepseekMigrationApplyArgument],
    environment: {},
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
    runStatus: async () => {
      calls.push("status");
      return "pending_exact";
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
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
  assert.equal(stdout, `${hostedDeepseekMigrationApplySuccessMessage}\n`);
});

test("DeepSeek migration commands fail before external work on arguments or inherited secrets", async () => {
  for (const runCli of [runHostedDeepseekMigrationStatusCli, runHostedDeepseekMigrationDryRunCli]) {
    let calls = 0;
    const external = async () => {
      calls += 1;
      throw new Error("private-detail");
    };
    await runCli({
      arguments_: [],
      environment: { PGPASSWORD: "secret" },
      fetchCaCertificate: external,
      readPassword: external,
      runStatusQuery: external,
      runSupabase: external,
      writeError: () => undefined,
      writeOutput: () => undefined,
    });
    assert.equal(calls, 0);
  }
});

test("DeepSeek migration gates the pinned Supabase CLI before secrets and remote work", async () => {
  const evidenceCalls = [];
  assert.equal(
    await runHostedDeepseekMigrationDryRunCli({
      arguments_: [hostedDeepseekMigrationDryRunArgument],
      environment: {},
      fetchCaCertificate: async () => {
        evidenceCalls.push("ca");
        return caCertificate;
      },
      runPreflight: async () => {
        evidenceCalls.push("evidence");
        return false;
      },
      verifySupabaseCli: async () => {
        evidenceCalls.push("supabase-cli");
        return true;
      },
      writeError: () => undefined,
    }),
    1,
  );
  assert.deepEqual(evidenceCalls, ["evidence"]);

  const dryRunCalls = [];
  const code = await runHostedDeepseekMigrationDryRunCli({
    arguments_: [hostedDeepseekMigrationDryRunArgument],
    environment: {},
    fetchCaCertificate: async () => {
      dryRunCalls.push("ca");
      return caCertificate;
    },
    readPassword: async () => {
      dryRunCalls.push("password");
      return "fictional-administrator-password";
    },
    runSupabase: async () => {
      dryRunCalls.push("dry-run");
      return { code: 0, stderr: validDryRunOutput, stdout: "" };
    },
    runPreflight: async () => {
      dryRunCalls.push("evidence");
      return true;
    },
    verifySupabaseCli: async () => {
      dryRunCalls.push("supabase-cli");
      return false;
    },
    writeError: () => undefined,
  });
  assert.equal(code, 1);
  assert.deepEqual(dryRunCalls, ["evidence", "supabase-cli"]);

  const preflightCalls = [];
  assert.equal(
    await runHostedDeepseekMigrationPreflight({
      runBackupCli: async () => {
        preflightCalls.push("evidence");
        return 0;
      },
      verifyRepositoryIdentity: async () => {
        preflightCalls.push("repository");
        return true;
      },
      verifySupabaseCli: async () => {
        preflightCalls.push("supabase-cli");
        return false;
      },
    }),
    false,
  );
  assert.deepEqual(preflightCalls, ["evidence", "repository", "supabase-cli"]);
});

test("DeepSeek migration apply pins byte-identical mirrors and fixed hashes", async () => {
  await assert.doesNotReject(verifyHostedDeepseekMigrationRepositoryIdentity());
  let reads = 0;
  await assert.rejects(
    verifyHostedDeepseekMigrationRepositoryIdentity({
      readMigrationFile: async () => {
        reads += 1;
        return Buffer.from(reads === 1 ? "one" : "two");
      },
    }),
    /repository identity is invalid/u,
  );
});

test("DeepSeek migration apply refuses mutation unless every immediate gate is exact", async () => {
  let secretCalls = 0;
  let applyCalls = 0;
  assert.equal(
    await runHostedDeepseekMigrationApplyCli({
      arguments_: [hostedDeepseekMigrationApplyArgument],
      environment: {},
      fetchCaCertificate: async () => {
        secretCalls += 1;
        return caCertificate;
      },
      readPassword: async () => {
        secretCalls += 1;
        return "fictional-administrator-password";
      },
      runApply: async () => {
        applyCalls += 1;
        return { code: 0 };
      },
      runPreflight: async () => false,
      writeError: () => undefined,
    }),
    1,
  );
  assert.equal(secretCalls, 0);
  assert.equal(applyCalls, 0);

  for (const { dryRun, preflightResults, status } of [
    {
      dryRun: { code: 0, stderr: `${validDryRunOutput}unexpected\n`, stdout: "" },
      preflightResults: [true],
      status: "pending_exact",
    },
    {
      dryRun: { code: 0, stderr: validDryRunOutput, stdout: "" },
      preflightResults: [true, false],
      status: "pending_exact",
    },
    {
      dryRun: { code: 0, stderr: validDryRunOutput, stdout: "" },
      preflightResults: [true, true],
      status: "applied_exact",
    },
    {
      dryRun: { code: 0, stderr: validDryRunOutput, stdout: "" },
      preflightResults: [true, true],
      status: "uncertain",
    },
  ]) {
    let preflightCalls = 0;
    let statusCalls = 0;
    applyCalls = 0;
    const code = await runHostedDeepseekMigrationApplyCli({
      arguments_: [hostedDeepseekMigrationApplyArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runApply: async () => {
        applyCalls += 1;
        return { code: 0 };
      },
      runDryRun: async () => dryRun,
      runPreflight: async () => preflightResults[preflightCalls++],
      runStatus: async () => {
        statusCalls += 1;
        return status;
      },
      writeError: () => undefined,
    });
    assert.equal(code, 1);
    assert.equal(applyCalls, 0);
    assert.equal(statusCalls, preflightResults.length === 2 && preflightResults[1] ? 1 : 0);
  }
});

test("DeepSeek migration apply hides mutation and postflight failures", async () => {
  for (const { applyResult, postflightResult } of [
    { applyResult: { code: 1 }, postflightResult: true },
    { applyResult: { code: 0 }, postflightResult: false },
  ]) {
    let stderr = "";
    let stdout = "";
    const code = await runHostedDeepseekMigrationApplyCli({
      arguments_: [hostedDeepseekMigrationApplyArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runApply: async () => applyResult,
      runDryRun: async () => ({ code: 0, stderr: validDryRunOutput, stdout: "" }),
      runPostflight: async () => postflightResult,
      runPreflight: async () => true,
      runStatus: async () => "pending_exact",
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: (value) => {
        stdout += value;
      },
    });
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /^Hosted DeepSeek 0016-0021 migration apply did not produce/u);
    assert.doesNotMatch(stderr, /private|password|certificate/u);
  }
});

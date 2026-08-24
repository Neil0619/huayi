import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedImportantBatchPostCaptureReadinessArgument,
  hostedImportantBatchPreCaptureReadinessArgument,
  hostedImportantBatchRebuildReadinessArgument,
  inspectHostedImportantBatchBackupRuntime,
  renderHostedImportantBatchBackupExecutorPlan,
  runHostedImportantBatchBackupExecutorCli,
} from "./acceptance-hosted-important-batch-backup-executor.mjs";
import {
  hostedImportantBatchBackupArtifactDirectory,
  hostedImportantBatchId,
} from "./acceptance-hosted-important-batch-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";

function readyRepositoryState(overrides = {}) {
  return {
    artifactRootIgnored: true,
    candidateCommit,
    worktreeClean: true,
    ...overrides,
  };
}

function unavailableRuntime(overrides = {}) {
  return {
    dockerDaemonReady: false,
    pinnedPostgres17RuntimeReady: false,
    pinnedScratchRuntimeReady: false,
    supabaseCliPinned: true,
    ...overrides,
  };
}

async function runCli({
  arguments_,
  repositoryState = readyRepositoryState(),
  runtime = unavailableRuntime(),
} = {}) {
  const calls = [];
  let stderr = "";
  let stdout = "";
  const code = await runHostedImportantBatchBackupExecutorCli({
    arguments_,
    inspectRuntime: async () => {
      calls.push("inspect-runtime");
      return runtime;
    },
    readRepositoryState: async () => {
      calls.push("read-repository");
      return repositoryState;
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  return { calls, code, stderr, stdout };
}

test("executor plan is deterministic, zero-I/O, and states exact coverage and blockers", async () => {
  let calls = 0;
  let stderr = "";
  let stdout = "";
  const code = await runHostedImportantBatchBackupExecutorCli({
    arguments_: ["--plan"],
    inspectRuntime: async () => {
      calls += 1;
      return unavailableRuntime();
    },
    readRepositoryState: async () => {
      calls += 1;
      return readyRepositoryState();
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, renderHostedImportantBatchBackupExecutorPlan());
  assert.match(stdout, new RegExp(hostedAcceptanceProjectRef, "u"));
  assert.match(stdout, new RegExp(hostedImportantBatchId, "u"));
  assert.match(stdout, new RegExp(hostedImportantBatchBackupArtifactDirectory, "u"));
  assert.match(stdout, /session pooler port 5432/u);
  assert.match(stdout, /transaction pooler port 6543 is forbidden/u);
  assert.match(stdout, /PostgreSQL 17/u);
  assert.match(stdout, /Supabase CLI 2\.115\.0/u);
  assert.match(stdout, /Auth database rows/u);
  assert.match(stdout, /Storage metadata/u);
  assert.match(stdout, /does not include Storage object bytes/u);
  assert.match(stdout, /does not include global roles or hosted platform configuration/u);
  assert.match(stdout, /partial file/u);
  assert.match(stdout, /fsync/u);
  assert.match(stdout, /atomic rename/u);
  assert.match(stdout, /manifest last/u);
  assert.match(stdout, /raw stdout or stderr/u);
  assert.match(stdout, /blocked fail-closed/u);
});

test("package scripts expose only plan and exact readiness checks, not executable capture or rebuild", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:executor:plan"],
    "node scripts/acceptance-hosted-important-batch-backup-executor.mjs --plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:executor:pre:readiness"],
    `node scripts/acceptance-hosted-important-batch-backup-executor.mjs ${hostedImportantBatchPreCaptureReadinessArgument}`,
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:executor:rebuild:readiness"],
    `node scripts/acceptance-hosted-important-batch-backup-executor.mjs ${hostedImportantBatchRebuildReadinessArgument}`,
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:executor:post:readiness"],
    `node scripts/acceptance-hosted-important-batch-backup-executor.mjs ${hostedImportantBatchPostCaptureReadinessArgument}`,
  );
  assert.equal(packageDocument.scripts["acceptance:hosted:backup:capture:pre"], undefined);
  assert.equal(packageDocument.scripts["acceptance:hosted:backup:rebuild"], undefined);
  assert.equal(packageDocument.scripts["acceptance:hosted:backup:capture:post"], undefined);
});

test("all three exact readiness checks fail closed before any executor or evidence write", async () => {
  for (const argument of [
    hostedImportantBatchPreCaptureReadinessArgument,
    hostedImportantBatchRebuildReadinessArgument,
    hostedImportantBatchPostCaptureReadinessArgument,
  ]) {
    const result = await runCli({ arguments_: [argument] });

    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, ["read-repository", "inspect-runtime"]);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Hosted important-batch executor readiness failed closed; no operation was performed.\n",
    );
  }
});

test("readiness remains blocked with local tools present because no repository-pinned executor exists", async () => {
  const result = await runCli({
    arguments_: [hostedImportantBatchPreCaptureReadinessArgument],
    runtime: unavailableRuntime({
      dockerDaemonReady: true,
      pinnedPostgres17RuntimeReady: true,
      pinnedScratchRuntimeReady: true,
      supabaseCliPinned: true,
    }),
  });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "Hosted important-batch executor readiness failed closed; no operation was performed.\n",
  );
});

test("dirty or unignored repository state fails before runtime inspection", async () => {
  for (const repositoryState of [
    readyRepositoryState({ worktreeClean: false }),
    readyRepositoryState({ artifactRootIgnored: false }),
    readyRepositoryState({ candidateCommit: "not-a-commit" }),
  ]) {
    const result = await runCli({
      arguments_: [hostedImportantBatchPreCaptureReadinessArgument],
      repositoryState,
    });

    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, ["read-repository"]);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Hosted important-batch executor readiness failed closed; no operation was performed.\n",
    );
  }
});

test("invalid or injected arguments perform zero inspection and never reflect sensitive input", async () => {
  const sensitive = "private-user@example.test";
  for (const arguments_ of [
    [],
    ["capture"],
    [hostedImportantBatchPreCaptureReadinessArgument, "--path", sensitive],
    ["--readiness-pre-0014-important-batch-backup-other-project"],
  ]) {
    const result = await runCli({ arguments_ });

    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, []);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Hosted important-batch executor arguments are invalid.\n");
    assert.doesNotMatch(result.stderr, new RegExp(sensitive, "u"));
  }
});

test("runtime diagnostics classify only allowlisted readiness and discard raw process output", async () => {
  const sensitive = "private-user@example.test";
  const calls = [];
  let stderr = "";
  let stdout = "";
  const code = await runHostedImportantBatchBackupExecutorCli({
    arguments_: [hostedImportantBatchRebuildReadinessArgument],
    inspectRuntime: async () => {
      calls.push({
        arguments: ["--version"],
        command: "pg_dump",
        rawStderr: sensitive,
        rawStdout: sensitive,
      });
      return unavailableRuntime();
    },
    readRepositoryState: async () => readyRepositoryState(),
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 1);
  assert.equal(calls.length, 1);
  assert.equal(stdout, "");
  assert.equal(
    stderr,
    "Hosted important-batch executor readiness failed closed; no operation was performed.\n",
  );
  assert.doesNotMatch(stderr, new RegExp(sensitive, "u"));
});

test("runtime inspector uses fixed argument arrays and returns booleans instead of raw output", async () => {
  const calls = [];
  const outputs = [
    { code: 0, stdout: "pg_dump (PostgreSQL) 17.6\n" },
    { code: 0, stdout: "pg_restore (PostgreSQL) 17.6\n" },
    { code: 0, stdout: "psql (PostgreSQL) 17.6\n" },
    { code: 0, stdout: "2.115.0\n" },
    { code: 0, stdout: "29.4.0\n" },
  ];
  const runtime = await inspectHostedImportantBatchBackupRuntime({
    runInspection: async (command, arguments_) => {
      calls.push({ arguments: arguments_, command });
      return outputs[calls.length - 1];
    },
  });

  assert.deepEqual(calls.slice(0, 3), [
    { arguments: ["--version"], command: "pg_dump" },
    { arguments: ["--version"], command: "pg_restore" },
    { arguments: ["--version"], command: "psql" },
  ]);
  assert.match(calls[3].command, /node_modules\/.bin\/supabase$/u);
  assert.deepEqual(calls[3].arguments, ["--version"]);
  assert.deepEqual(calls[4], {
    arguments: [
      "--host",
      "unix:///var/run/docker.sock",
      "version",
      "--format",
      "{{.Server.Version}}",
    ],
    command: "docker",
  });
  assert.deepEqual(runtime, {
    dockerDaemonReady: true,
    pinnedPostgres17RuntimeReady: true,
    pinnedScratchRuntimeReady: false,
    supabaseCliPinned: true,
  });
  assert.equal(JSON.stringify(runtime).includes("17.6"), false);
});

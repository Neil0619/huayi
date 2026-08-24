import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedImportantBatchPostCaptureReadinessArgument,
  hostedImportantBatchPostgresImage,
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
import {
  hostedImportantBatchCapturePostArgument,
  hostedImportantBatchCapturePreArgument,
} from "./acceptance-hosted-important-batch-capture.mjs";
import { hostedImportantBatchPostgresRuntimeReference } from "./acceptance-hosted-important-batch-execution-contract.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { hostedImportantBatchRebuildArgument } from "./acceptance-hosted-important-batch-rebuild.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const fixedTestDockerTarget = {
  command: "/fixed/local/docker",
  host: "unix:///fixed/local/docker.sock",
};

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
    artifactEncryptionReady: false,
    dockerDaemonReady: false,
    pinnedPostgres17RuntimeReady: false,
    pinnedScratchRuntimeReady: false,
    supabaseCliPinned: true,
    ...overrides,
  };
}

function readyRuntime() {
  return unavailableRuntime({
    artifactEncryptionReady: true,
    dockerDaemonReady: true,
    pinnedPostgres17RuntimeReady: true,
    pinnedScratchRuntimeReady: true,
    supabaseCliPinned: true,
  });
}

async function runCli({
  arguments_,
  captureBackup,
  readCaptureSecrets,
  rebuildScratch,
  repositoryState = readyRepositoryState(),
  runtime = unavailableRuntime(),
} = {}) {
  const calls = [];
  let stderr = "";
  let stdout = "";
  const code = await runHostedImportantBatchBackupExecutorCli({
    arguments_,
    captureBackup:
      captureBackup ??
      (async (options) => {
        calls.push({ capture: options });
      }),
    inspectRuntime: async () => {
      calls.push("inspect-runtime");
      return runtime;
    },
    readRepositoryState: async () => {
      calls.push("read-repository");
      return repositoryState;
    },
    readCaptureSecrets:
      readCaptureSecrets ??
      (async () => {
        calls.push("read-secrets");
        return { administratorPassword: "private-password", caCertificate: "private-ca" };
      }),
    rebuildScratch:
      rebuildScratch ??
      (async (options) => {
        calls.push({ rebuild: options });
      }),
    repositoryRoot: "/fixed/repository",
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
  assert.ok(stdout.includes(hostedImportantBatchPostgresImage));
  assert.ok(stdout.includes(hostedImportantBatchPostgresRuntimeReference));
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
  assert.match(stdout, /\.pgpass/u);
  assert.match(stdout, /reviewed writer is pinned/u);
  assert.match(stdout, /confirmation-gated/u);
  assert.match(stdout, /--pull never/u);
  assert.match(stdout, /--network none/u);
});

test("package scripts expose only exact plan, readiness, and confirmation-gated operations", async () => {
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
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:capture:pre"],
    `node scripts/acceptance-hosted-important-batch-backup-executor.mjs ${hostedImportantBatchCapturePreArgument}`,
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:rebuild"],
    `node scripts/acceptance-hosted-important-batch-backup-executor.mjs ${hostedImportantBatchRebuildArgument}`,
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:capture:post"],
    `node scripts/acceptance-hosted-important-batch-backup-executor.mjs ${hostedImportantBatchCapturePostArgument}`,
  );
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

test("readiness passes only after the clean candidate and complete pinned runtime are proven", async () => {
  const result = await runCli({
    arguments_: [hostedImportantBatchPreCaptureReadinessArgument],
    runtime: readyRuntime(),
  });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "Hosted important-batch pre readiness passed.\n");
  assert.equal(result.stderr, "");
});

test("confirmation-gated capture reads secrets only after readiness and passes no dynamic identity", async () => {
  for (const [argument, phase] of [
    [hostedImportantBatchCapturePreArgument, "pre"],
    [hostedImportantBatchCapturePostArgument, "post"],
  ]) {
    const result = await runCli({ arguments_: [argument], runtime: readyRuntime() });

    assert.equal(result.code, 0);
    assert.deepEqual(result.calls.slice(0, 3), [
      "read-repository",
      "inspect-runtime",
      "read-secrets",
    ]);
    assert.deepEqual(result.calls[3], {
      capture: {
        administratorPassword: "private-password",
        caCertificate: "private-ca",
        candidateCommit,
        phase,
        repositoryRoot: "/fixed/repository",
      },
    });
    assert.equal(result.stdout, `Hosted important-batch ${phase} backup captured.\n`);
    assert.equal(result.stderr, "");
  }
});

test("confirmation-gated rebuild never requests Hosted secrets and records only fixed success", async () => {
  const result = await runCli({
    arguments_: [hostedImportantBatchRebuildArgument],
    runtime: readyRuntime(),
  });

  assert.equal(result.code, 0);
  assert.deepEqual(result.calls, [
    "read-repository",
    "inspect-runtime",
    { rebuild: { candidateCommit, repositoryRoot: "/fixed/repository" } },
  ]);
  assert.equal(result.stdout, "Hosted important-batch isolated rebuild verified and destroyed.\n");
  assert.equal(result.stderr, "");
});

test("execution failure discards raw secrets and errors and emits one fixed failure", async () => {
  const sensitive = "private-user@example.test";
  const result = await runCli({
    arguments_: [hostedImportantBatchCapturePreArgument],
    captureBackup: async () => {
      throw new Error(sensitive);
    },
    readCaptureSecrets: async () => ({
      administratorPassword: sensitive,
      caCertificate: sensitive,
    }),
    runtime: readyRuntime(),
  });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Hosted important-batch executor operation failed closed.\n");
  assert.doesNotMatch(result.stderr, new RegExp(sensitive, "u"));
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
  const platformCalls = [];
  const runtime = await inspectHostedImportantBatchBackupRuntime({
    inspectPlatformImages: async (options) => {
      platformCalls.push(options);
      assert.deepEqual(await options.resolveDockerTarget(), fixedTestDockerTarget);
      assert.equal(options.runInspection, undefined);
      return { ready: true };
    },
    resolveDockerTarget: async () => fixedTestDockerTarget,
    runInspection: async (command, arguments_) => {
      calls.push({ arguments: arguments_, command });
      if (command.endsWith("/node_modules/.bin/supabase")) {
        return { code: 0, stdout: "2.115.0\n" };
      }
      if (command === "/usr/bin/fdesetup") return { code: 0, stdout: "FileVault is On.\n" };
      if (arguments_.includes("version")) return { code: 0, stdout: "29.4.0\n" };
      return { code: 1, stdout: "unexpected inspection" };
    },
  });

  assert.deepEqual(calls[0], {
    arguments: ["--host", fixedTestDockerTarget.host, "version", "--format", "{{.Server.Version}}"],
    command: fixedTestDockerTarget.command,
  });
  assert.equal(platformCalls.length, 1);
  assert.equal(
    calls.some((call) => call.arguments.includes("inspect")),
    false,
  );
  assert.equal(
    calls.some((call) => /node_modules\/.bin\/supabase$/u.test(call.command)),
    true,
  );
  assert.equal(
    calls.some((call) => call.command === "/usr/bin/fdesetup"),
    true,
  );
  assert.deepEqual(runtime, {
    artifactEncryptionReady: true,
    dockerDaemonReady: true,
    pinnedPostgres17RuntimeReady: true,
    pinnedScratchRuntimeReady: true,
    supabaseCliPinned: true,
  });
  assert.equal(JSON.stringify(runtime).includes("86a2e078"), false);
});

test("real runtime inspection rejects remote Docker selectors before any command", async () => {
  const originalDockerHost = process.env.DOCKER_HOST;
  const originalDockerContext = process.env.DOCKER_CONTEXT;
  try {
    process.env.DOCKER_HOST = "tcp://private.example.test:2376";
    process.env.DOCKER_CONTEXT = "remote-private";

    const calls = [];
    const runtime = await inspectHostedImportantBatchBackupRuntime({
      runInspection: async (command, arguments_) => {
        calls.push({ arguments: arguments_, command });
        return { code: 0, stdout: "unexpected" };
      },
    });

    assert.deepEqual(calls, []);
    assert.deepEqual(runtime, unavailableRuntime({ supabaseCliPinned: false }));
  } finally {
    if (originalDockerHost === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = originalDockerHost;
    if (originalDockerContext === undefined) delete process.env.DOCKER_CONTEXT;
    else process.env.DOCKER_CONTEXT = originalDockerContext;
  }
});

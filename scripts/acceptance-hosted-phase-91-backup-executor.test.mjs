import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedPhase91PostCaptureReadinessArgument,
  hostedPhase91PreCaptureReadinessArgument,
  hostedPhase91RebuildReadinessArgument,
  renderHostedPhase91BackupExecutorPlan,
  runHostedPhase91BackupExecutorCli,
} from "./acceptance-hosted-phase-91-backup-executor.mjs";
import {
  hostedPhase91BackupArtifactDirectory,
  hostedPhase91BackupId,
} from "./acceptance-hosted-phase-91-backup.mjs";
import {
  hostedPhase91CapturePostArgument,
  hostedPhase91CapturePreArgument,
} from "./acceptance-hosted-phase-91-capture.mjs";
import { hostedPhase91RebuildArgument } from "./acceptance-hosted-phase-91-rebuild.mjs";
import { HostedImportantBatchRebuildStageError } from "./acceptance-hosted-important-batch-rebuild.mjs";

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
    artifactEncryptionReady: false,
    dockerDaemonReady: false,
    dockerTargetReady: true,
    localPlatformImagesReady: false,
    pinnedPostgres17RuntimeReady: false,
    pinnedScratchRuntimeReady: false,
    platformLockReady: true,
    supabaseCliPinned: true,
    ...overrides,
  };
}

function readyRuntime() {
  return unavailableRuntime({
    artifactEncryptionReady: true,
    dockerDaemonReady: true,
    localPlatformImagesReady: true,
    pinnedPostgres17RuntimeReady: true,
    pinnedScratchRuntimeReady: true,
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
  const code = await runHostedPhase91BackupExecutorCli({
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
    readCaptureSecrets:
      readCaptureSecrets ??
      (async () => {
        calls.push("read-secrets");
        return { administratorPassword: "private-password", caCertificate: "private-ca" };
      }),
    readRepositoryState: async () => {
      calls.push("read-repository");
      return repositoryState;
    },
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

test("Phase 91 executor plan is deterministic and performs zero I/O", async () => {
  let calls = 0;
  let stdout = "";
  const code = await runHostedPhase91BackupExecutorCli({
    arguments_: ["--plan"],
    inspectRuntime: async () => {
      calls += 1;
    },
    readRepositoryState: async () => {
      calls += 1;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.equal(stdout, renderHostedPhase91BackupExecutorPlan());
  assert.match(stdout, new RegExp(hostedPhase91BackupId, "u"));
  assert.match(stdout, new RegExp(hostedPhase91BackupArtifactDirectory, "u"));
  assert.match(stdout, /20260824010000/u);
  assert.match(stdout, /20260825010000/u);
  assert.match(stdout, /session pooler port 5432/u);
  assert.match(stdout, /15 repository migrations/u);
  assert.match(stdout, /zero Hosted connection/u);
  assert.match(stdout, /Phase 81.+never read/isu);
});

test("package exposes only exact Phase 91 plan, readiness, and write operations", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const executable = "node scripts/acceptance-hosted-phase-91-backup-executor.mjs";
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase91:backup:executor:plan"],
    `${executable} --plan`,
  );
  for (const [name, argument] of [
    ["executor:pre:readiness", hostedPhase91PreCaptureReadinessArgument],
    ["executor:rebuild:readiness", hostedPhase91RebuildReadinessArgument],
    ["executor:post:readiness", hostedPhase91PostCaptureReadinessArgument],
    ["capture:pre", hostedPhase91CapturePreArgument],
    ["rebuild", hostedPhase91RebuildArgument],
    ["capture:post", hostedPhase91CapturePostArgument],
  ]) {
    assert.equal(
      packageDocument.scripts[`acceptance:hosted:phase91:backup:${name}`],
      `${executable} ${argument}`,
    );
  }
});

test("Phase 91 readiness checks fail closed and pass only for a clean pinned runtime", async () => {
  for (const argument of [
    hostedPhase91PreCaptureReadinessArgument,
    hostedPhase91RebuildReadinessArgument,
    hostedPhase91PostCaptureReadinessArgument,
  ]) {
    const failed = await runCli({ arguments_: [argument] });
    assert.deepEqual(failed.calls, ["read-repository", "inspect-runtime"]);
    assert.equal(failed.code, 1);
    assert.equal(
      failed.stderr,
      "Hosted important-batch executor readiness failed closed at allowlisted stage docker-daemon; no operation was performed.\n",
    );

    const passed = await runCli({ arguments_: [argument], runtime: readyRuntime() });
    assert.equal(passed.code, 0);
    assert.match(passed.stdout, /^Hosted Phase 91 (?:pre|rebuild|post) readiness passed\.\n$/u);
  }
});

test("Phase 91 capture reads secrets only after readiness and uses fixed phase identity", async () => {
  for (const [argument, phase] of [
    [hostedPhase91CapturePreArgument, "pre"],
    [hostedPhase91CapturePostArgument, "post"],
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
    assert.equal(result.stdout, `Hosted Phase 91 ${phase} backup captured.\n`);
  }
});

test("Phase 91 rebuild never reads Hosted secrets and records fixed success", async () => {
  const result = await runCli({
    arguments_: [hostedPhase91RebuildArgument],
    runtime: readyRuntime(),
  });
  assert.deepEqual(result.calls, [
    "read-repository",
    "inspect-runtime",
    { rebuild: { candidateCommit, repositoryRoot: "/fixed/repository" } },
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "Hosted Phase 91 isolated rebuild verified and destroyed.\n");
});

test("Phase 91 execution failures discard secrets and expose only fixed boundaries", async () => {
  const sensitive = "private-user@example.test /private/path sha256:secret";
  const capture = await runCli({
    arguments_: [hostedPhase91CapturePreArgument],
    captureBackup: async () => {
      throw new Error(sensitive);
    },
    runtime: readyRuntime(),
  });
  assert.equal(capture.code, 1);
  assert.equal(capture.stderr, "Hosted Phase 91 backup executor operation failed closed.\n");
  assert.doesNotMatch(capture.stderr, new RegExp(sensitive, "u"));

  const rebuild = await runCli({
    arguments_: [hostedPhase91RebuildArgument],
    rebuildScratch: async () => {
      const error = new HostedImportantBatchRebuildStageError("baseline");
      error.cause = new Error(sensitive);
      throw error;
    },
    runtime: readyRuntime(),
  });
  assert.equal(rebuild.code, 1);
  assert.equal(
    rebuild.stderr,
    "Hosted important-batch isolated rebuild failed closed at allowlisted stage baseline; Hosted data was not modified.\n",
  );
  assert.doesNotMatch(rebuild.stderr, new RegExp(sensitive, "u"));
});

test("Phase 91 executor rejects dirty state and injected arguments before writes", async () => {
  const dirty = await runCli({
    arguments_: [hostedPhase91CapturePreArgument],
    repositoryState: readyRepositoryState({ worktreeClean: false }),
    runtime: readyRuntime(),
  });
  assert.deepEqual(dirty.calls, ["read-repository"]);
  assert.equal(dirty.code, 1);
  assert.equal(dirty.stderr, "Hosted Phase 91 backup executor operation failed closed.\n");

  const sensitive = "private-user@example.test";
  for (const arguments_ of [
    [],
    ["capture"],
    [hostedPhase91CapturePreArgument, "--path", sensitive],
    ["--confirm-capture-pre-0015-public-function-acl-hardening-other-project"],
  ]) {
    const invalid = await runCli({ arguments_ });
    assert.deepEqual(invalid.calls, []);
    assert.equal(invalid.code, 1);
    assert.equal(invalid.stderr, "Hosted Phase 91 backup executor arguments are invalid.\n");
    assert.doesNotMatch(invalid.stderr, new RegExp(sensitive, "u"));
  }
});

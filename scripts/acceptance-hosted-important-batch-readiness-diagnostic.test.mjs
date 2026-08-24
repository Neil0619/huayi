import assert from "node:assert/strict";
import test from "node:test";

import {
  hostedImportantBatchPreCaptureReadinessArgument,
  inspectHostedImportantBatchBackupRuntime,
  runHostedImportantBatchBackupExecutorCli,
} from "./acceptance-hosted-important-batch-backup-executor.mjs";
import { hostedImportantBatchCapturePreArgument } from "./acceptance-hosted-important-batch-capture.mjs";
import { hostedImportantBatchRebuildArgument } from "./acceptance-hosted-important-batch-rebuild.mjs";
import {
  assessHostedImportantBatchReadiness,
  renderHostedImportantBatchReadinessFailure,
} from "./acceptance-hosted-important-batch-readiness-diagnostic.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const fixedDockerTarget = {
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

function readyRuntime(overrides = {}) {
  return {
    artifactEncryptionReady: true,
    dockerDaemonReady: true,
    dockerTargetReady: true,
    localPlatformImagesReady: true,
    pinnedPostgres17RuntimeReady: true,
    pinnedScratchRuntimeReady: true,
    platformLockReady: true,
    supabaseCliPinned: true,
    ...overrides,
  };
}

function runSuccessfulProcessInspection(command, arguments_) {
  if (command.endsWith("/node_modules/.bin/supabase")) {
    return { code: 0, stdout: "2.115.0\n" };
  }
  if (command === "/usr/bin/fdesetup") return { code: 0, stdout: "FileVault is On.\n" };
  if (arguments_.includes("version")) return { code: 0, stdout: "29.4.0\n" };
  return { code: 1, stdout: "" };
}

async function runCli({
  argument = hostedImportantBatchPreCaptureReadinessArgument,
  inspectRuntime = async () => readyRuntime(),
  readRepositoryState = async () => readyRepositoryState(),
} = {}) {
  let stderr = "";
  let stdout = "";
  const code = await runHostedImportantBatchBackupExecutorCli({
    arguments_: [argument],
    inspectRuntime,
    readRepositoryState,
    repositoryRoot: "/fixed/repository",
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  return { code, stderr, stdout };
}

test("readiness assessment returns only a fixed structured stage and candidate identity", async () => {
  const passed = await assessHostedImportantBatchReadiness({
    inspectRuntime: async () => readyRuntime(),
    readRepositoryState: async () => readyRepositoryState(),
    repositoryRoot: "/fixed/repository",
  });
  const failed = await assessHostedImportantBatchReadiness({
    inspectRuntime: async () =>
      readyRuntime({ dockerDaemonReady: false, supabaseCliPinned: false }),
    readRepositoryState: async () => readyRepositoryState(),
    repositoryRoot: "/fixed/repository",
  });
  const legacyWriterUnavailable = await assessHostedImportantBatchReadiness({
    inspectRuntime: async () => readyRuntime({ pinnedScratchRuntimeReady: false }),
    readRepositoryState: async () => readyRepositoryState(),
    repositoryRoot: "/fixed/repository",
  });

  assert.deepEqual(passed, { candidateCommit, failedStage: null, ready: true });
  assert.deepEqual(failed, {
    candidateCommit: null,
    failedStage: "docker-daemon",
    ready: false,
  });
  assert.equal(Object.isFrozen(passed), true);
  assert.equal(Object.isFrozen(failed), true);
  assert.equal(legacyWriterUnavailable.failedStage, "local-platform-images");
  assert.throws(
    () => renderHostedImportantBatchReadinessFailure("private-dynamic-stage"),
    /readiness stage is invalid/u,
  );
});

test("runtime inspection distinguishes platform lock from local image availability", async () => {
  const lockUnavailable = await inspectHostedImportantBatchBackupRuntime({
    inspectPlatformImages: async () => ({ ready: true }),
    readPlatformLock: async () => ({ services: [] }),
    resolveDockerTarget: async () => fixedDockerTarget,
    runInspection: runSuccessfulProcessInspection,
    verifyPlatformLock: async () => {
      throw new Error("private lock details");
    },
  });
  const imagesUnavailable = await inspectHostedImportantBatchBackupRuntime({
    inspectPlatformImages: async () => {
      throw new Error("private image details");
    },
    readPlatformLock: async () => ({ services: [] }),
    resolveDockerTarget: async () => fixedDockerTarget,
    runInspection: runSuccessfulProcessInspection,
    verifyPlatformLock: async () => ({ verified: true }),
  });

  assert.equal(lockUnavailable.platformLockReady, false);
  assert.equal(lockUnavailable.localPlatformImagesReady, false);
  assert.equal(imagesUnavailable.platformLockReady, true);
  assert.equal(imagesUnavailable.localPlatformImagesReady, false);
  assert.doesNotMatch(JSON.stringify([lockUnavailable, imagesUnavailable]), /private/u);
});

test("readiness reports only the first fixed allowlisted failing stage", async () => {
  const cases = [
    {
      expected: "repository-state",
      readRepositoryState: async () => readyRepositoryState({ worktreeClean: false }),
    },
    {
      expected: "docker-target",
      inspectRuntime: async () => readyRuntime({ dockerTargetReady: false }),
    },
    {
      expected: "docker-daemon",
      inspectRuntime: async () => readyRuntime({ dockerDaemonReady: false }),
    },
    {
      expected: "supabase-cli",
      inspectRuntime: async () => readyRuntime({ supabaseCliPinned: false }),
    },
    {
      expected: "filevault",
      inspectRuntime: async () => readyRuntime({ artifactEncryptionReady: false }),
    },
    {
      expected: "platform-lock",
      inspectRuntime: async () =>
        readyRuntime({
          localPlatformImagesReady: false,
          pinnedPostgres17RuntimeReady: false,
          pinnedScratchRuntimeReady: false,
          platformLockReady: false,
        }),
    },
    {
      expected: "local-platform-images",
      inspectRuntime: async () =>
        readyRuntime({
          localPlatformImagesReady: false,
          pinnedPostgres17RuntimeReady: false,
          pinnedScratchRuntimeReady: false,
        }),
    },
  ];

  for (const testCase of cases) {
    const result = await runCli(testCase);

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      `Hosted important-batch executor readiness failed closed at allowlisted stage ${testCase.expected}; no operation was performed.\n`,
    );
  }
});

test("unexpected runtime inspection rejection maps to one fixed stage without raw data", async () => {
  const sensitive = "private-user@example.test /private/path sha256:secret";
  const result = await runCli({
    inspectRuntime: async () => {
      throw new Error(sensitive);
    },
  });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "Hosted important-batch executor readiness failed closed at allowlisted stage runtime-inspection; no operation was performed.\n",
  );
  assert.doesNotMatch(result.stderr, new RegExp(sensitive, "u"));
});

test("capture and rebuild keep their single generic failure boundary", async () => {
  for (const argument of [
    hostedImportantBatchCapturePreArgument,
    hostedImportantBatchRebuildArgument,
  ]) {
    const result = await runCli({
      argument,
      readRepositoryState: async () => readyRepositoryState({ worktreeClean: false }),
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Hosted important-batch executor operation failed closed.\n");
  }
});

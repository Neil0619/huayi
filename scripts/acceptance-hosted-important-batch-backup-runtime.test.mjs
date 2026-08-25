import assert from "node:assert/strict";
import test from "node:test";

import { inspectHostedImportantBatchBackupRuntime } from "./acceptance-hosted-important-batch-backup-executor.mjs";

const fixedTestDockerTarget = {
  command: "/fixed/local/docker",
  host: "unix:///fixed/local/docker.sock",
};

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
    platform: "darwin",
    runInspection: async (command, arguments_) => {
      calls.push({ arguments: arguments_, command });
      if (/[\\/]node_modules[\\/]\.bin[\\/]supabase$/u.test(command)) {
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
    calls.some((call) => /node_modules[\\/]\.bin[\\/]supabase$/u.test(call.command)),
    true,
  );
  assert.equal(
    calls.some((call) => call.command === "/usr/bin/fdesetup"),
    true,
  );
  assert.deepEqual(runtime, {
    artifactEncryptionReady: true,
    dockerDaemonReady: true,
    dockerTargetReady: true,
    localPlatformImagesReady: true,
    pinnedPostgres17RuntimeReady: true,
    pinnedScratchRuntimeReady: true,
    platformLockReady: true,
    supabaseCliPinned: true,
  });
  assert.equal(JSON.stringify(runtime).includes("86a2e078"), false);
});

test("runtime inspector derives artifact encryption from the declared platform", async () => {
  const runtime = await inspectHostedImportantBatchBackupRuntime({
    inspectPlatformImages: async () => ({ ready: true }),
    platform: "win32",
    readPlatformLock: async () => ({}),
    resolveDockerTarget: async () => fixedTestDockerTarget,
    runInspection: async (command, arguments_) => {
      if (/[\\/]node_modules[\\/]\.bin[\\/]supabase$/u.test(command)) {
        return { code: 0, stdout: "2.115.0\n" };
      }
      if (command === "/usr/bin/fdesetup") return { code: 0, stdout: "FileVault is On.\n" };
      if (arguments_.includes("version")) return { code: 0, stdout: "29.4.0\n" };
      return { code: 1, stdout: "" };
    },
    verifyPlatformLock: async () => undefined,
  });

  assert.equal(runtime.artifactEncryptionReady, false);
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
    assert.deepEqual(
      runtime,
      unavailableRuntime({
        dockerTargetReady: false,
        platformLockReady: false,
        supabaseCliPinned: false,
      }),
    );
  } finally {
    if (originalDockerHost === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = originalDockerHost;
    if (originalDockerContext === undefined) delete process.env.DOCKER_CONTEXT;
    else process.env.DOCKER_CONTEXT = originalDockerContext;
  }
});

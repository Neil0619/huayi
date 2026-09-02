import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectHostedReleaseGit,
  pushHostedReleaseCandidate,
  runHostedReleaseLocalQuality,
} from "./acceptance-hosted-release-git.mjs";

const candidateSha = "c".repeat(40);
const upstreamSha = "d".repeat(40);

function fakeGit(outputs, calls) {
  return async (command, arguments_, options) => {
    calls.push({ arguments_, command, options });
    const key = `${command} ${arguments_.join(" ")}`;
    const output = outputs.get(key);
    if (output === undefined) return { status: 1, stderr: "", stdout: "" };
    return { status: 0, stderr: "", stdout: output };
  };
}

test("Git inspection binds one clean disarmed candidate and allows only local-ahead history", async () => {
  const calls = [];
  const outputs = new Map([
    ["git rev-parse --show-toplevel", "/repo\n"],
    ["git symbolic-ref --quiet --short HEAD", "codex/settings-configuration\n"],
    ["git status --porcelain=v1 --untracked-files=normal", ""],
    ["git rev-parse HEAD", `${candidateSha}\n`],
    ["git rev-parse @{upstream}", `${upstreamSha}\n`],
    ["git merge-base --is-ancestor @{upstream} HEAD", ""],
  ]);
  const readFile = async (path) =>
    JSON.stringify({ git: { deploymentEnabled: false }, path: String(path) });

  assert.deepEqual(
    await inspectHostedReleaseGit({
      readFile,
      repositoryRoot: "/repo",
      runProcess: fakeGit(outputs, calls),
    }),
    {
      branch: "codex/settings-configuration",
      candidateSha,
      clean: true,
      pushed: false,
      upstreamSha,
      vercelDisarmed: true,
    },
  );
  assert.equal(calls.at(-1).arguments_.join(" "), "merge-base --is-ancestor @{upstream} HEAD");
});

test("local quality finishes the complete macOS gate with an audited Hosted Store package", async () => {
  const calls = [];
  await runHostedReleaseLocalQuality({
    actualPlatform: "darwin",
    environment: {
      HOME: "/Users/test",
      PATH: "/bin:/usr/bin",
      npm_execpath: "/tool/pnpm.cjs",
      UNRELATED_SECRET: "must-not-pass",
    },
    repositoryRoot: "/repo",
    runProcess: async (command, arguments_, options) => {
      calls.push({ arguments_, command, options });
      return { status: 0, stderr: "", stdout: "" };
    },
  });

  assert.deepEqual(
    calls.map(({ arguments_ }) => arguments_),
    [
      ["/tool/pnpm.cjs", "verify:macos"],
      ["/tool/pnpm.cjs", "acceptance:hosted:store:build"],
    ],
  );
  for (const call of calls) {
    assert.equal(call.options.environment.UNRELATED_SECRET, undefined);
    assert.equal(call.options.environment.VERCEL_TOKEN, undefined);
  }
});

test("local quality fails closed when the Hosted Store package cannot be built", async () => {
  const calls = [];
  await assert.rejects(
    runHostedReleaseLocalQuality({
      actualPlatform: "darwin",
      environment: { PATH: "/bin:/usr/bin" },
      repositoryRoot: "/repo",
      runProcess: async (_command, arguments_) => {
        calls.push(arguments_);
        return { status: arguments_[0] === "verify:macos" ? 0 : 1, stderr: "", stdout: "" };
      },
    }),
    /Hosted acceptance release Git failed closed/u,
  );
  assert.deepEqual(calls, [["verify:macos"], ["acceptance:hosted:store:build"]]);
});

test("candidate push uses the fixed branch and verifies the exact remote SHA", async () => {
  const calls = [];
  const runProcess = async (command, arguments_) => {
    calls.push([command, arguments_]);
    if (arguments_[0] === "push") return { status: 0, stderr: "", stdout: "" };
    return {
      status: 0,
      stderr: "",
      stdout: `${candidateSha}\trefs/heads/codex/settings-configuration\n`,
    };
  };

  await pushHostedReleaseCandidate({
    candidateSha,
    environment: {},
    repositoryRoot: "/repo",
    runProcess,
  });
  assert.deepEqual(calls, [
    ["git", ["push", "origin", "HEAD:refs/heads/codex/settings-configuration"]],
    ["git", ["ls-remote", "--exit-code", "origin", "refs/heads/codex/settings-configuration"]],
  ]);
});

test("candidate push rejects inherited plaintext credentials before invoking Git", async () => {
  let called = false;
  await assert.rejects(
    pushHostedReleaseCandidate({
      candidateSha,
      environment: { PGPASSWORD: "runner-image-fixture" },
      repositoryRoot: "/repo",
      runProcess: async () => {
        called = true;
        return { status: 0, stderr: "", stdout: "" };
      },
    }),
    /Hosted acceptance release Git failed closed/u,
  );
  assert.equal(called, false);
});

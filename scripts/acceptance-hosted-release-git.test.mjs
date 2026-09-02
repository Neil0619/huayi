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

test("local quality runs the complete macOS gate without forwarding plaintext credentials", async () => {
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

  assert.deepEqual(calls[0].arguments_, ["/tool/pnpm.cjs", "verify:macos"]);
  assert.equal(calls[0].options.environment.UNRELATED_SECRET, undefined);
  assert.equal(calls[0].options.environment.VERCEL_TOKEN, undefined);
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

  await pushHostedReleaseCandidate({ candidateSha, repositoryRoot: "/repo", runProcess });
  assert.deepEqual(calls, [
    ["git", ["push", "origin", "HEAD:refs/heads/codex/settings-configuration"]],
    ["git", ["ls-remote", "--exit-code", "origin", "refs/heads/codex/settings-configuration"]],
  ]);
});

import { readFile as readFileFromDisk } from "node:fs/promises";
import { join } from "node:path";

import { rejectLegacyHostedCredentialEnvironment } from "./acceptance-hosted-credentials.mjs";
import { hostedReleaseBranch } from "./acceptance-hosted-release-contract.mjs";
import {
  hostedReleaseChildEnvironment,
  runHostedReleaseProcess,
} from "./acceptance-hosted-release-process.mjs";

const commitPattern = /^[0-9a-f]{40}$/u;
const maximumOutputBytes = 1_000_000;

function fail() {
  throw new Error("Hosted acceptance release Git failed closed.");
}

async function runGit(runProcess, repositoryRoot, arguments_) {
  const result = await runProcess("git", arguments_, { cwd: repositoryRoot });
  if (
    result?.status !== 0 ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string" ||
    result.stderr !== "" ||
    Buffer.byteLength(result.stdout, "utf8") > maximumOutputBytes
  ) {
    fail();
  }
  return result.stdout;
}

function line(value, pattern) {
  if (!value.endsWith("\n") || value.slice(0, -1).includes("\n")) fail();
  const result = value.slice(0, -1);
  if (!pattern.test(result)) fail();
  return result;
}

function isDisarmed(source) {
  try {
    const parsed = JSON.parse(source);
    return parsed?.git?.deploymentEnabled === false;
  } catch {
    return false;
  }
}

export async function inspectHostedReleaseGit({
  readFile = readFileFromDisk,
  repositoryRoot = process.cwd(),
  runProcess = runHostedReleaseProcess,
} = {}) {
  try {
    const [root, branch, status, candidate, upstream, apiSource, webSource] = await Promise.all([
      runGit(runProcess, repositoryRoot, ["rev-parse", "--show-toplevel"]),
      runGit(runProcess, repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
      runGit(runProcess, repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=normal"]),
      runGit(runProcess, repositoryRoot, ["rev-parse", "HEAD"]),
      runGit(runProcess, repositoryRoot, ["rev-parse", "@{upstream}"]),
      readFile(join(repositoryRoot, "apps/api/vercel.json"), "utf8"),
      readFile(join(repositoryRoot, "apps/web/vercel.json"), "utf8"),
    ]);
    const actualRoot = line(root, /^\/.+/u);
    const actualBranch = line(branch, /^[A-Za-z0-9._/-]{1,200}$/u);
    const candidateSha = line(candidate, commitPattern);
    const upstreamSha = line(upstream, commitPattern);
    if (
      actualRoot !== repositoryRoot ||
      actualBranch !== hostedReleaseBranch ||
      status !== "" ||
      !isDisarmed(apiSource) ||
      !isDisarmed(webSource)
    ) {
      fail();
    }
    if (candidateSha !== upstreamSha) {
      await runGit(runProcess, repositoryRoot, [
        "merge-base",
        "--is-ancestor",
        "@{upstream}",
        "HEAD",
      ]);
    }
    return Object.freeze({
      branch: actualBranch,
      candidateSha,
      clean: true,
      pushed: candidateSha === upstreamSha,
      upstreamSha,
      vercelDisarmed: true,
    });
  } catch {
    fail();
  }
}

export async function runHostedReleaseLocalQuality({
  actualPlatform = process.platform,
  environment = process.env,
  repositoryRoot = process.cwd(),
  runProcess = runHostedReleaseProcess,
} = {}) {
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
    if (actualPlatform !== "darwin") fail();
    const childEnvironment = hostedReleaseChildEnvironment(environment);
    const executable = typeof environment.npm_execpath === "string" ? process.execPath : "pnpm";
    for (const script of ["verify:macos", "acceptance:hosted:store:build"]) {
      const arguments_ =
        typeof environment.npm_execpath === "string"
          ? [environment.npm_execpath, script]
          : [script];
      const result = await runProcess(executable, arguments_, {
        cwd: repositoryRoot,
        environment: childEnvironment,
        inherit: true,
      });
      if (result?.status !== 0) fail();
    }
  } catch {
    fail();
  }
}

export async function pushHostedReleaseCandidate({
  candidateSha,
  environment = process.env,
  repositoryRoot = process.cwd(),
  runProcess = runHostedReleaseProcess,
} = {}) {
  try {
    if (typeof candidateSha !== "string" || !commitPattern.test(candidateSha)) fail();
    rejectLegacyHostedCredentialEnvironment(environment);
    const options = {
      cwd: repositoryRoot,
      environment: hostedReleaseChildEnvironment(environment),
    };
    const push = await runProcess(
      "git",
      ["push", "origin", `HEAD:refs/heads/${hostedReleaseBranch}`],
      options,
    );
    if (
      push?.status !== 0 ||
      typeof push.stdout !== "string" ||
      typeof push.stderr !== "string" ||
      Buffer.byteLength(`${push.stdout}${push.stderr}`, "utf8") > maximumOutputBytes
    ) {
      fail();
    }
    const remote = await runProcess(
      "git",
      ["ls-remote", "--exit-code", "origin", `refs/heads/${hostedReleaseBranch}`],
      options,
    );
    if (
      remote?.status !== 0 ||
      remote.stderr !== "" ||
      remote.stdout !== `${candidateSha}\trefs/heads/${hostedReleaseBranch}\n`
    ) {
      fail();
    }
  } catch {
    fail();
  }
}

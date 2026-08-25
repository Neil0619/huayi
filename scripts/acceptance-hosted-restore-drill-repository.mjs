import { spawn } from "node:child_process";

import { hostedRestoreDrillArtifactRoot } from "./acceptance-hosted-restore-drill-contract.mjs";

function fail() {
  throw new Error("Hosted restore-drill repository state failed.");
}

function runGitProcess(arguments_, repositoryRoot) {
  return new Promise((resolveResult) => {
    let stdout = "";
    let overflow = false;
    const child = spawn("git", arguments_, {
      cwd: repositoryRoot,
      env: {
        GIT_OPTIONAL_LOCKS: "0",
        LANG: "C",
        LC_ALL: "C",
        PATH: process.env.PATH ?? "",
      },
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > 16_384) {
        overflow = true;
        stdout = "";
        child.kill("SIGKILL");
      } else if (!overflow) {
        stdout += chunk;
      }
    });
    child.once("error", () => resolveResult({ code: null, stdout: "" }));
    child.once("close", (code, signal) => {
      resolveResult({
        code: overflow || signal !== null ? null : code,
        stdout: overflow ? "" : stdout,
      });
    });
  });
}

export async function inspectHostedRestoreDrillRepository({
  repositoryRoot,
  runGit = (arguments_) => runGitProcess(arguments_, repositoryRoot),
}) {
  const [head, upstream, status, ignored] = await Promise.all([
    runGit(["rev-parse", "--verify", "HEAD"]),
    runGit(["rev-parse", "--verify", "@{upstream}"]),
    runGit(["status", "--porcelain=v1", "--untracked-files=normal"]),
    runGit(["check-ignore", "--quiet", "--", hostedRestoreDrillArtifactRoot]),
  ]);
  const candidateCommit = head.code === 0 ? head.stdout.trim() : "";
  const upstreamCommit = upstream.code === 0 ? upstream.stdout.trim() : "";
  const result = {
    artifactRootIgnored: ignored.code === 0 && ignored.stdout === "",
    candidateCommit,
    upstreamExact: upstreamCommit === candidateCommit,
    worktreeClean: status.code === 0 && status.stdout === "",
  };
  if (
    !/^[0-9a-f]{40}$/u.test(candidateCommit) ||
    !result.artifactRootIgnored ||
    !result.upstreamExact ||
    !result.worktreeClean
  ) {
    fail();
  }
  return result;
}

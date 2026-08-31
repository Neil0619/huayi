import { spawn } from "node:child_process";
import { join } from "node:path";

import { assertHostedImportantBatchArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import {
  realHostedImportantBatchEvidenceIo,
  verifyHostedImportantBatchEvidencePhase,
} from "./acceptance-hosted-important-batch-evidence.mjs";

const secureArtifactRoot = "artifacts/hosted-important-batch-backups";

function invalidEvidence() {
  throw new Error("Hosted important-batch historical evidence is invalid.");
}

function invalidRepositoryState() {
  throw new Error("Hosted important-batch historical repository state is invalid.");
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

export async function inspectHostedImportantBatchHistoricalRepository({
  artifactDirectory,
  historicalCandidateCommit,
  repositoryRoot,
  runGit = (arguments_) => runGitProcess(arguments_, repositoryRoot),
}) {
  if (!/^[0-9a-f]{40}$/u.test(historicalCandidateCommit)) invalidRepositoryState();
  const [head, upstream, status, ignored, candidate, ancestor] = await Promise.all([
    runGit(["rev-parse", "--verify", "HEAD"]),
    runGit(["rev-parse", "--verify", "@{upstream}"]),
    runGit(["status", "--porcelain=v1", "--untracked-files=normal"]),
    runGit(["check-ignore", "--quiet", "--", artifactDirectory]),
    runGit(["cat-file", "-e", `${historicalCandidateCommit}^{commit}`]),
    runGit(["merge-base", "--is-ancestor", historicalCandidateCommit, "HEAD"]),
  ]);
  const currentCommit = head.code === 0 ? head.stdout.trim() : "";
  const upstreamCommit = upstream.code === 0 ? upstream.stdout.trim() : "";
  const result = {
    artifactRootIgnored: ignored.code === 0 && ignored.stdout === "",
    currentCommit,
    historicalCandidateCommit,
    historicalCandidateExists: candidate.code === 0,
    historicalCandidateIsAncestor: ancestor.code === 0,
    upstreamExact: upstreamCommit === currentCommit,
    worktreeClean: status.code === 0 && status.stdout === "",
  };
  if (
    !/^[0-9a-f]{40}$/u.test(currentCommit) ||
    !result.artifactRootIgnored ||
    !result.historicalCandidateExists ||
    !result.historicalCandidateIsAncestor ||
    !result.upstreamExact ||
    !result.worktreeClean
  ) {
    invalidRepositoryState();
  }
  return result;
}

function assertExactEntries(actual, expected) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((entry, index) => entry !== sortedExpected[index])
  ) {
    invalidEvidence();
  }
}

async function assertSecureDirectory(evidenceIo, path) {
  const stats = await evidenceIo.lstat(path);
  if (!stats.isDirectory() || (stats.mode & 0o777) !== 0o700) invalidEvidence();
}

export async function verifyHostedImportantBatchHistoricalEvidence({
  artifactContract,
  evidenceIo = realHostedImportantBatchEvidenceIo,
  readRepositoryState,
  root,
}) {
  assertHostedImportantBatchArtifactContract(artifactContract);
  const artifactRoot = join(root, secureArtifactRoot);
  const batchRoot = join(root, artifactContract.artifactDirectory);
  await assertSecureDirectory(evidenceIo, artifactRoot);
  await assertSecureDirectory(evidenceIo, batchRoot);
  assertExactEntries(await evidenceIo.readdir(batchRoot), ["post", "pre", "rebuild"]);

  const pre = await verifyHostedImportantBatchEvidencePhase({
    artifactContract,
    batchRoot,
    evidenceIo,
    phase: "pre",
  });
  const rebuild = await verifyHostedImportantBatchEvidencePhase({
    artifactContract,
    batchRoot,
    evidenceIo,
    phase: "rebuild",
  });
  const post = await verifyHostedImportantBatchEvidencePhase({
    artifactContract,
    batchRoot,
    evidenceIo,
    phase: "post",
  });
  if (
    rebuild.candidateCommit !== pre.candidateCommit ||
    post.candidateCommit !== pre.candidateCommit ||
    Date.parse(post.capturedAt) < Date.parse(pre.capturedAt) ||
    Date.parse(post.capturedAt) < Date.parse(rebuild.completedAt)
  ) {
    invalidEvidence();
  }

  const state = await readRepositoryState(root, pre.candidateCommit);
  if (
    state.artifactRootIgnored !== true ||
    !/^[0-9a-f]{40}$/u.test(state.currentCommit) ||
    state.historicalCandidateCommit !== pre.candidateCommit ||
    state.historicalCandidateExists !== true ||
    state.historicalCandidateIsAncestor !== true ||
    state.upstreamExact !== true ||
    state.worktreeClean !== true
  ) {
    invalidEvidence();
  }
}

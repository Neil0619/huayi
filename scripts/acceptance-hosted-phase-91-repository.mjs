import { spawn } from "node:child_process";

function invalidRepositoryState() {
  throw new Error("Hosted Phase 91 historical repository state is invalid.");
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

export async function inspectHostedPhase91HistoricalRepository({
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

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runGitProcess(arguments_) {
  return new Promise((resolveResult) => {
    let stdout = "";
    let overflow = false;
    let settled = false;
    let timeout;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(result);
    };
    let child;
    try {
      child = spawn("git", arguments_, {
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
    } catch {
      finish({ code: null, stdout: "" });
      return;
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > 16_384) {
        overflow = true;
        stdout = "";
        try {
          child.kill("SIGKILL");
        } catch {
          finish({ code: null, stdout: "" });
        }
      } else if (!overflow) {
        stdout += chunk;
      }
    });
    timeout = setTimeout(() => {
      overflow = true;
      stdout = "";
      try {
        child.kill("SIGKILL");
      } catch {
        finish({ code: null, stdout: "" });
      }
    }, 10_000);
    child.once("error", () => finish({ code: null, stdout: "" }));
    child.once("close", (code, signal) =>
      finish({ code: overflow || signal !== null ? null : code, stdout: overflow ? "" : stdout }),
    );
  });
}

export async function verifyHostedCronRepositoryCandidate({ runGit = runGitProcess } = {}) {
  try {
    const [head, upstream, status] = await Promise.all([
      runGit(["rev-parse", "--verify", "HEAD"]),
      runGit(["rev-parse", "--verify", "@{upstream}"]),
      runGit(["status", "--porcelain=v1", "--untracked-files=normal"]),
    ]);
    const candidateCommit = head.code === 0 ? head.stdout.trim() : "";
    const upstreamCommit = upstream.code === 0 ? upstream.stdout.trim() : "";
    if (
      !/^[0-9a-f]{40}$/u.test(candidateCommit) ||
      upstreamCommit !== candidateCommit ||
      status.code !== 0 ||
      status.stdout !== ""
    ) {
      throw new Error("invalid");
    }
    return true;
  } catch {
    throw new Error("Hosted Supabase Cron repository-candidate is invalid.");
  }
}

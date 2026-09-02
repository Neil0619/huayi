import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const commitPattern = /^[0-9a-f]{40}$/u;
const releasePattern = /^hosted-acceptance-([0-9a-f]{40})$/u;
const failureMessage = "Cross-platform candidate verification failed.";

function fail() {
  throw new Error(failureMessage);
}

async function defaultRunProcess(command, arguments_) {
  try {
    const result = await execFileAsync(command, arguments_, {
      encoding: "utf8",
      maxBuffer: 4_096,
      shell: false,
    });
    return { status: 0, stderr: result.stderr, stdout: result.stdout };
  } catch {
    return { status: 1, stderr: "", stdout: "" };
  }
}

export async function assertCiCandidate({
  environment = process.env,
  runProcess = defaultRunProcess,
} = {}) {
  try {
    const candidateSha = environment.HUAYI_CI_CANDIDATE_SHA;
    const releaseId = environment.HUAYI_CI_RELEASE_ID;
    const releaseMatch = typeof releaseId === "string" ? releasePattern.exec(releaseId) : null;
    if (
      typeof candidateSha !== "string" ||
      !commitPattern.test(candidateSha) ||
      (releaseId !== "automatic" && releaseMatch?.[1] !== candidateSha)
    ) {
      fail();
    }
    const result = await runProcess("git", ["rev-parse", "HEAD"]);
    if (result?.status !== 0 || result.stderr !== "" || result.stdout !== `${candidateSha}\n`) {
      fail();
    }
  } catch {
    fail();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertCiCandidate().catch(() => {
    process.stderr.write(`${failureMessage}\n`);
    process.exitCode = 1;
  });
}

import {
  hostedReleaseBranch,
  releaseIdForCandidate,
} from "./acceptance-hosted-release-contract.mjs";
import {
  hostedReleaseChildEnvironment,
  runHostedReleaseProcess,
} from "./acceptance-hosted-release-process.mjs";

const workflow = "cross-platform-quality.yml";
const maximumOutputBytes = 1_000_000;
const statuses = new Set(["completed", "in_progress", "pending", "queued", "requested", "waiting"]);

function fail() {
  throw new Error("Hosted acceptance release CI failed closed.");
}

function expectedTitle(candidateSha, releaseId) {
  if (releaseId !== releaseIdForCandidate(candidateSha)) fail();
  return `Cross-platform quality / ${releaseId} / ${candidateSha}`;
}

function parseJson(result) {
  if (
    result?.status !== 0 ||
    result.stderr !== "" ||
    typeof result.stdout !== "string" ||
    Buffer.byteLength(result.stdout, "utf8") > maximumOutputBytes
  ) {
    fail();
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail();
  }
}

function normalizeRun(raw, candidateSha, releaseId) {
  const title = expectedTitle(candidateSha, releaseId);
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    !Number.isSafeInteger(raw.databaseId) ||
    raw.databaseId <= 0 ||
    raw.displayTitle !== title ||
    raw.headSha !== candidateSha ||
    !statuses.has(raw.status) ||
    !["", null, "success", "failure", "cancelled", "timed_out"].includes(raw.conclusion) ||
    typeof raw.url !== "string" ||
    !/^https:\/\/github\.com\/Neil0619\/huayi\/actions\/runs\/\d+$/u.test(raw.url)
  ) {
    fail();
  }
  return Object.freeze({
    conclusion: raw.conclusion === "" ? null : raw.conclusion,
    id: raw.databaseId,
    status: raw.status,
  });
}

export function createHostedReleaseCi({
  environment = process.env,
  repositoryRoot = process.cwd(),
  runProcess = runHostedReleaseProcess,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const options = {
    cwd: repositoryRoot,
    environment: hostedReleaseChildEnvironment(environment),
  };
  async function gh(arguments_) {
    return runProcess("gh", arguments_, options);
  }
  return Object.freeze({
    async dispatch({ candidateSha, releaseId }) {
      try {
        expectedTitle(candidateSha, releaseId);
        const result = await gh([
          "workflow",
          "run",
          workflow,
          "--ref",
          hostedReleaseBranch,
          "-f",
          `candidate_sha=${candidateSha}`,
          "-f",
          `release_id=${releaseId}`,
        ]);
        if (result?.status !== 0 || result.stderr !== "" || result.stdout !== "") fail();
      } catch {
        fail();
      }
    },
    async find({ candidateSha, releaseId }) {
      try {
        const raw = parseJson(
          await gh([
            "run",
            "list",
            "--workflow",
            workflow,
            "--branch",
            hostedReleaseBranch,
            "--event",
            "workflow_dispatch",
            "--limit",
            "50",
            "--json",
            "conclusion,createdAt,databaseId,displayTitle,headSha,status,url",
          ]),
        );
        if (!Array.isArray(raw)) fail();
        const title = expectedTitle(candidateSha, releaseId);
        const matches = raw.filter(
          (item) => item?.displayTitle === title || item?.headSha === candidateSha,
        );
        if (matches.length > 1) fail();
        return matches.length === 0 ? undefined : normalizeRun(matches[0], candidateSha, releaseId);
      } catch {
        fail();
      }
    },
    async wait({ candidateSha, releaseId, runId }) {
      try {
        if (!Number.isSafeInteger(runId) || runId <= 0) fail();
        for (let attempt = 0; attempt < 181; attempt += 1) {
          const raw = parseJson(
            await gh([
              "run",
              "view",
              String(runId),
              "--json",
              "conclusion,databaseId,displayTitle,headSha,jobs,status,url",
            ]),
          );
          const run = normalizeRun(raw, candidateSha, releaseId);
          if (run.id !== runId) fail();
          if (run.status !== "completed") {
            await sleep(15_000);
            continue;
          }
          if (
            run.conclusion !== "success" ||
            !Array.isArray(raw.jobs) ||
            raw.jobs.length !== 2 ||
            raw.jobs
              .map(({ name }) => name)
              .sort()
              .join("|") !== "macos-quality|windows-quality" ||
            raw.jobs.some((job) => job.status !== "completed" || job.conclusion !== "success")
          ) {
            fail();
          }
          return run;
        }
        fail();
      } catch {
        fail();
      }
    },
  });
}

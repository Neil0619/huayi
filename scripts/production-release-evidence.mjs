import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { productionTargets } from "./production-release-vercel.mjs";

export function assertProductionCi(candidateSha, runId, { run, jobs }) {
  const fail = () => {
    throw new Error("Exact production candidate CI evidence is incomplete.");
  };
  if (
    !/^[a-f0-9]{40}$/u.test(candidateSha) ||
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    run?.id !== runId ||
    run.head_sha !== candidateSha ||
    run.event !== "workflow_dispatch" ||
    run.path !== ".github/workflows/cross-platform-quality.yml" ||
    run.display_title !== `Cross-platform quality / production-${candidateSha} / ${candidateSha}` ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    jobs?.total_count !== 2 ||
    !Array.isArray(jobs.jobs) ||
    jobs.jobs.length !== 2
  )
    fail();
  for (const platform of ["macos", "windows"]) {
    const matches = jobs.jobs.filter((job) => job?.name === `${platform}-quality`);
    if (
      matches.length !== 1 ||
      matches[0].status !== "completed" ||
      matches[0].conclusion !== "success" ||
      !Array.isArray(matches[0].steps)
    )
      fail();
    for (const name of ["Verify exact candidate", `Run pnpm verify:${platform}`]) {
      const steps = matches[0].steps.filter((step) => step.name === name);
      if (steps.length !== 1 || steps[0].conclusion !== "success") fail();
    }
  }
  return Object.freeze({ runId, candidateSha, passed: true });
}

export function createProductionAttemptRecorder(directory) {
  return async (attempt) => {
    const allowed = ["candidateSha", "attemptId", "releaseId", "kind", "projectId", "phase"];
    const environment = attempt?.phase === "environment";
    if (
      !attempt ||
      Object.keys(attempt).some((key) => !allowed.includes(key)) ||
      !["api", "web"].includes(attempt.kind) ||
      attempt.projectId !== productionTargets[attempt.kind].id ||
      !/^[a-f0-9]{32}$/u.test(attempt.attemptId) ||
      (environment
        ? attempt.releaseId !== "production-environment" || attempt.candidateSha !== undefined
        : !/^[a-f0-9]{40}$/u.test(attempt.candidateSha) ||
          attempt.releaseId !== `production-${attempt.candidateSha}` ||
          attempt.phase !== undefined)
    ) {
      throw new Error("Production release attempt is invalid.");
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const handle = await open(
      join(directory, `${attempt.releaseId}-${attempt.kind}.json`),
      "wx",
      0o600,
    );
    try {
      await handle.writeFile(
        JSON.stringify(
          {
            ...attempt,
            recordedAt: new Date().toISOString(),
            status: "outcome-unknown-until-readback",
          },
          null,
          2,
        ) + "\n",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
  };
}

export async function withProductionReleaseLock(directory, operation) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, ".lock");
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + "\n",
    );
    await handle.sync();
    return await operation();
  } finally {
    await handle.close();
    await rm(path);
  }
}

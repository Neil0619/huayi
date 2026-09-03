import {
  createHostedCronBootstrapReleaseState,
  createHostedReleaseAttemptId,
  hostedCronBootstrapReleaseProvenance,
  hostedReleaseBranch,
  validateHostedReleaseState,
} from "./acceptance-hosted-release-contract.mjs";
import { inspectHostedReleaseGit } from "./acceptance-hosted-release-git.mjs";
import { createHostedReleaseRuntime } from "./acceptance-hosted-release-runtime.mjs";
import { createHostedReleaseStateStore } from "./acceptance-hosted-release-state.mjs";

function fail() {
  throw new Error("Hosted Cron bootstrap release gate failed closed.");
}

function exactCandidate(candidate, expectedSha) {
  return (
    candidate?.branch === hostedReleaseBranch &&
    /^[0-9a-f]{40}$/u.test(candidate.candidateSha) &&
    (expectedSha === undefined || candidate.candidateSha === expectedSha) &&
    candidate.clean === true &&
    candidate.pushed === true &&
    candidate.upstreamSha === candidate.candidateSha &&
    candidate.vercelDisarmed === true
  );
}

export async function createHostedCronBootstrapReleaseGate({
  createReleaseAttemptId = createHostedReleaseAttemptId,
  createRuntime = createHostedReleaseRuntime,
  createStateStore = createHostedReleaseStateStore,
  fetch_ = globalThis.fetch,
  inspectCandidate = inspectHostedReleaseGit,
  now = Date.now,
  repositoryRoot = process.cwd(),
} = {}) {
  if (
    typeof createRuntime !== "function" ||
    typeof createReleaseAttemptId !== "function" ||
    typeof createStateStore !== "function" ||
    typeof inspectCandidate !== "function" ||
    typeof now !== "function"
  ) {
    fail();
  }
  const candidate = await inspectCandidate({ repositoryRoot });
  if (!exactCandidate(candidate)) fail();
  const candidateSha = candidate.candidateSha;
  const stateStore = createStateStore({ candidateSha, repositoryRoot });
  if (
    typeof stateStore !== "object" ||
    stateStore === null ||
    typeof stateStore.acquire !== "function" ||
    typeof stateStore.read !== "function" ||
    typeof stateStore.write !== "function"
  ) {
    fail();
  }

  return Object.freeze({
    async attestCompleted() {
      try {
        const current = await inspectCandidate({ repositoryRoot });
        if (!exactCandidate(current, candidateSha)) fail();
        const state = validateHostedReleaseState(await stateStore.read());
        if (
          state.schemaVersion !== 3 ||
          state.candidateSha !== candidateSha ||
          state.phase !== "complete" ||
          state.provenance !== hostedCronBootstrapReleaseProvenance
        ) {
          fail();
        }
        const runtime = createRuntime({ fetch_ });
        if (typeof runtime?.attest !== "function") fail();
        await runtime.attest({
          apiDeploymentId: state.apiDeploymentId,
          candidateSha,
          releaseAttemptId: state.releaseAttemptId,
          webDeploymentId: state.webDeploymentId,
        });
      } catch {
        fail();
      }
    },
    async provision(operation) {
      if (typeof operation !== "function") fail();
      let release;
      try {
        release = await stateStore.acquire();
        if (typeof release !== "function" || (await stateStore.read()) !== undefined) fail();
        const current = await inspectCandidate({ repositoryRoot });
        if (!exactCandidate(current, candidateSha)) fail();
        const state = createHostedCronBootstrapReleaseState({
          candidateSha,
          now: now(),
          releaseAttemptId: createReleaseAttemptId(),
        });
        const result = await operation();
        await stateStore.write(state);
        return result;
      } finally {
        if (typeof release === "function") await release();
      }
    },
  });
}

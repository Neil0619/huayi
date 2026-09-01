import { validateVercelOneShotCompleteState } from "./acceptance-vercel-one-shot-contract.mjs";
import { phase93VercelOneShotBaselines } from "./acceptance-vercel-phase-93-one-shot.mjs";

const expected = Object.freeze({
  apiArmCommit: "959878a44ed12cb25f4886dac97cc35501f12571",
  apiConfigIdentity: "cc2b06ad9bbba07848cf0ecb68e0683282c2e41df7e83f50638f7fcb83d43d99",
  apiDeploymentCreatedAt: 1_788_255_123_987,
  apiDeploymentId: "dpl_9miGwwDqjGH68n5ysjjHRQQwMSSW",
  apiDisarmCommit: "d08646d01921e40b08b1780e0373ec188e8684c5",
  candidateCommit: "526ac493d094b0ed8bd5f2112c5577b9a2f949dd",
  webArmCommit: "339e419130f80190c582e7afb7a3fa3b4acbb3a8",
  webConfigIdentity: "d8c08a0ba11c3005549a03eced3f62195b2609401d9f3fe7531079898b514bb4",
  webDeploymentCreatedAt: 1_788_255_734_281,
  webDeploymentId: "dpl_7fHbE9VxXL73CJ93RSpYnxAhvDS6",
  webDisarmCommit: "8a3f9b9a2204b8e884b0d7da589d96bb7f73dcf3",
});

function fail() {
  throw new Error("Hosted Phase 93 Vercel completion verification failed.");
}

function deploymentExact(deployment, project, commit, id, createdAt) {
  return (
    deployment?.createdAt === createdAt &&
    deployment?.id === id &&
    deployment?.project === project &&
    deployment?.sha === commit &&
    deployment?.state === "READY"
  );
}

export function validatePhase93VercelCompletion(state) {
  try {
    validateVercelOneShotCompleteState(state, phase93VercelOneShotBaselines);
    if (
      state.candidateCommit !== expected.candidateCommit ||
      state.apiArmCommit !== expected.apiArmCommit ||
      state.apiDisarmCommit !== expected.apiDisarmCommit ||
      state.webArmCommit !== expected.webArmCommit ||
      state.webDisarmCommit !== expected.webDisarmCommit ||
      state.configIdentities.api !== expected.apiConfigIdentity ||
      state.configIdentities.web !== expected.webConfigIdentity ||
      !deploymentExact(
        state.apiDeployment,
        "api",
        expected.apiArmCommit,
        expected.apiDeploymentId,
        expected.apiDeploymentCreatedAt,
      ) ||
      !deploymentExact(
        state.webDeployment,
        "web",
        expected.webArmCommit,
        expected.webDeploymentId,
        expected.webDeploymentCreatedAt,
      )
    ) {
      fail();
    }
  } catch {
    fail();
  }
}

import { validateVercelOneShotCompleteState } from "./acceptance-vercel-one-shot-contract.mjs";
import { phase93FreshCsrfVercelOneShotBaselines } from "./acceptance-vercel-phase-93-fresh-csrf-one-shot.mjs";

export const phase93FreshCsrfVercelCompletionIdentity = Object.freeze({
  apiArmCommit: "9c1a906fbabe04f3993fd47fa398569941194920",
  apiDeployment: Object.freeze({
    createdAt: 1_788_273_026_496,
    id: "dpl_9yRrWmWs4zhuJcALX92wM3LLr8mu",
    project: "api",
    sha: "9c1a906fbabe04f3993fd47fa398569941194920",
    state: "READY",
  }),
  apiDisarmCommit: "cd8b684c0c7719f0d11bfaec6f02b4db15d1acaf",
  candidateCommit: "396038919bd64f9914d940538ef750baa912b529",
  configIdentities: Object.freeze({
    api: "cc2b06ad9bbba07848cf0ecb68e0683282c2e41df7e83f50638f7fcb83d43d99",
    web: "d8c08a0ba11c3005549a03eced3f62195b2609401d9f3fe7531079898b514bb4",
  }),
  webArmCommit: "142720f719275a6527df31545b391d73c80f70c9",
  webDeployment: Object.freeze({
    createdAt: 1_788_274_077_491,
    id: "dpl_Bqaj9sapoJd4wnwxq24eMorJdPMd",
    project: "web",
    sha: "142720f719275a6527df31545b391d73c80f70c9",
    state: "READY",
  }),
  webDisarmCommit: "4012eeff522eaab945c8acbde9c8fc32a640853a",
});

function fail() {
  throw new Error("Hosted Phase 93 fresh-CSRF Vercel completion verification failed.");
}

function deploymentExact(deployment, expected) {
  return (
    deployment?.createdAt === expected.createdAt &&
    deployment?.id === expected.id &&
    deployment?.project === expected.project &&
    deployment?.sha === expected.sha &&
    deployment?.state === expected.state
  );
}

export function validatePhase93FreshCsrfVercelCompletion(state) {
  const expected = phase93FreshCsrfVercelCompletionIdentity;
  try {
    validateVercelOneShotCompleteState(state, phase93FreshCsrfVercelOneShotBaselines);
    if (
      state.candidateCommit !== expected.candidateCommit ||
      state.apiArmCommit !== expected.apiArmCommit ||
      state.apiDisarmCommit !== expected.apiDisarmCommit ||
      state.webArmCommit !== expected.webArmCommit ||
      state.webDisarmCommit !== expected.webDisarmCommit ||
      state.configIdentities.api !== expected.configIdentities.api ||
      state.configIdentities.web !== expected.configIdentities.web ||
      !deploymentExact(state.apiDeployment, expected.apiDeployment) ||
      !deploymentExact(state.webDeployment, expected.webDeployment)
    ) {
      fail();
    }
  } catch {
    fail();
  }
}

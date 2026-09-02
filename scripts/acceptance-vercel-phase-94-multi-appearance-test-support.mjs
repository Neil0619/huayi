export const candidate = "1".repeat(40);
export const apiArmCommit = "2".repeat(40);
export const apiDisarmCommit = "3".repeat(40);
export const webArmCommit = "4".repeat(40);
export const webDisarmCommit = "5".repeat(40);
export const token = "vercel-phase-94-multi-appearance-test-token";

const apiConfigIdentity = "a".repeat(64);
const webConfigIdentity = "b".repeat(64);
const freshApiArmCommit = "9c1a906fbabe04f3993fd47fa398569941194920";
const freshApiDisarmCommit = "cd8b684c0c7719f0d11bfaec6f02b4db15d1acaf";
const freshWebArmCommit = "142720f719275a6527df31545b391d73c80f70c9";
const freshWebDisarmCommit = "4012eeff522eaab945c8acbde9c8fc32a640853a";

export function deployment({ createdAt, id, project, sha, state = "READY" }) {
  return { createdAt, id, project, sha, state };
}

function history(project, count, latest, prefix) {
  return [
    latest,
    ...Array.from({ length: count - 1 }, (_, index) =>
      deployment({
        createdAt: 1_000 - index,
        id: `dpl_${project}_${prefix}_${index}`,
        project,
        sha: `${String((index % 9) + 1)}`.repeat(40),
      }),
    ),
  ];
}

function phase93FreshBaselineSnapshot() {
  return {
    api: history(
      "api",
      19,
      deployment({
        createdAt: 1_788_255_123_987,
        id: "dpl_9miGwwDqjGH68n5ysjjHRQQwMSSW",
        project: "api",
        sha: "959878a44ed12cb25f4886dac97cc35501f12571",
      }),
      "phase93_fresh_baseline",
    ),
    web: history(
      "web",
      12,
      deployment({
        createdAt: 1_788_255_734_281,
        id: "dpl_7fHbE9VxXL73CJ93RSpYnxAhvDS6",
        project: "web",
        sha: "339e419130f80190c582e7afb7a3fa3b4acbb3a8",
      }),
      "phase93_fresh_baseline",
    ),
  };
}

export function phase93FreshCompleteState() {
  return {
    apiArmCommit: freshApiArmCommit,
    apiDeployment: deployment({
      createdAt: 1_788_273_026_496,
      id: "dpl_9yRrWmWs4zhuJcALX92wM3LLr8mu",
      project: "api",
      sha: freshApiArmCommit,
    }),
    apiDisarmCommit: freshApiDisarmCommit,
    audits: { api: [], web: [] },
    baseline: phase93FreshBaselineSnapshot(),
    candidateCommit: "396038919bd64f9914d940538ef750baa912b529",
    configIdentities: {
      api: "cc2b06ad9bbba07848cf0ecb68e0683282c2e41df7e83f50638f7fcb83d43d99",
      web: "d8c08a0ba11c3005549a03eced3f62195b2609401d9f3fe7531079898b514bb4",
    },
    contract: "huayi-hosted-vercel-serial-one-shot/v1",
    phase: "complete",
    webArmCommit: freshWebArmCommit,
    webDeployment: deployment({
      createdAt: 1_788_274_077_491,
      id: "dpl_Bqaj9sapoJd4wnwxq24eMorJdPMd",
      project: "web",
      sha: freshWebArmCommit,
    }),
    webDisarmCommit: freshWebDisarmCommit,
  };
}

export function phase94BaselineSnapshot() {
  const historical = phase93FreshCompleteState();
  return {
    api: history("api", 20, historical.apiDeployment, "phase94_baseline"),
    web: history("web", 13, historical.webDeployment, "phase94_baseline"),
  };
}

export function gitState({
  apiArmed = false,
  branch = "codex/settings-configuration",
  changedFiles = [],
  clean = true,
  commit = candidate,
  parent = "0".repeat(40),
  upstreamCommit = commit,
  webArmed = false,
} = {}) {
  return {
    apiArmed,
    apiConfigIdentity,
    branch,
    changedFiles,
    clean,
    commit,
    parent,
    upstreamCommit,
    webArmed,
    webConfigIdentity,
  };
}

export async function tracedPhase94Snapshot({ fetch_ }) {
  for (let index = 0; index < 5; index += 1) await fetch_();
  return phase94BaselineSnapshot();
}

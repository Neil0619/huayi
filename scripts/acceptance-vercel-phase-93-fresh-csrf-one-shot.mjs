import { pathToFileURL } from "node:url";

import {
  renderVercelOneShotPlan,
  runVercelOneShotCli,
  vercelOneShotConfirmation,
} from "./acceptance-vercel-one-shot.mjs";
import { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";
import { validatePhase93VercelCompletion } from "./acceptance-vercel-phase-93-completion.mjs";

const freshCsrfStateIdentity = "phase-93-0023-fresh-csrf";
const historicalStateIdentity = "phase-93-0023";
const stages = new Set([
  "observe-api-arm",
  "observe-web-arm",
  "preflight",
  "verify-api-disarm",
  "verify-web-disarm",
]);

export const phase93FreshCsrfVercelOneShotConfirmation =
  "--confirm-hosted-vercel-phase-93-0023-fresh-csrf-serial-one-shot-neil0619s-projects";
export const phase93FreshCsrfVercelOneShotBaselines = Object.freeze({
  api: Object.freeze({
    count: 19,
    latestCommit: "959878a44ed12cb25f4886dac97cc35501f12571",
    latestDeploymentId: "dpl_9miGwwDqjGH68n5ysjjHRQQwMSSW",
  }),
  web: Object.freeze({
    count: 12,
    latestCommit: "339e419130f80190c582e7afb7a3fa3b4acbb3a8",
    latestDeploymentId: "dpl_7fHbE9VxXL73CJ93RSpYnxAhvDS6",
  }),
});

function normalizeArguments(arguments_) {
  if (arguments_.length === 3 && arguments_[1] === "--") return [arguments_[0], arguments_[2]];
  return arguments_;
}

export function renderPhase93FreshCsrfVercelOneShotPlan() {
  return [
    "Hosted Phase 93 fresh-CSRF API/Web serial redeployment gate (zero write plan)",
    "Independent state: artifacts/hosted-vercel-one-shot/phase-93-0023-fresh-csrf-state.json.",
    "Historical phase-93-0023-state.json remains immutable and must verify as complete.",
    "The fresh candidate 19 API / 12 Web non-Canceled baseline is pinned to that completion.",
    "It is not Hosted evidence until the independent fresh-CSRF diagnose is exact.",
    "Each API/Web arm and disarm remains a separately approved commit and push.",
    renderVercelOneShotPlan(phase93FreshCsrfVercelOneShotBaselines),
  ].join("\n");
}

export async function runPhase93FreshCsrfVercelOneShotCli({
  arguments_ = process.argv.slice(2),
  historicalStateStore,
  repositoryRoot = process.cwd(),
  stateStore,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
  ...dependencies
} = {}) {
  arguments_ = normalizeArguments(arguments_);
  if (arguments_.length === 1 && arguments_[0] === "plan") {
    writeOutput(renderPhase93FreshCsrfVercelOneShotPlan());
    return 0;
  }
  const stage = arguments_.length === 2 ? arguments_[0] : null;
  if (
    stage === null ||
    !stages.has(stage) ||
    arguments_[1] !== phase93FreshCsrfVercelOneShotConfirmation
  ) {
    writeError("Hosted Phase 93 fresh-CSRF Vercel one-shot gate failed.\n");
    return 1;
  }
  try {
    const completionStore =
      historicalStateStore ??
      createVercelOneShotStateStore({ repositoryRoot, stateIdentity: historicalStateIdentity });
    validatePhase93VercelCompletion(await completionStore.read());
  } catch {
    writeError("Hosted Phase 93 fresh-CSRF Vercel one-shot gate failed.\n");
    return 1;
  }
  return runVercelOneShotCli({
    ...dependencies,
    arguments_: [stage, vercelOneShotConfirmation],
    expectedBaselines: phase93FreshCsrfVercelOneShotBaselines,
    repositoryRoot,
    stateStore:
      stateStore ??
      createVercelOneShotStateStore({
        repositoryRoot,
        stateIdentity: freshCsrfStateIdentity,
      }),
    writeError: () => writeError("Hosted Phase 93 fresh-CSRF Vercel one-shot gate failed.\n"),
    writeOutput: () =>
      writeOutput(`Hosted Phase 93 fresh-CSRF Vercel one-shot gate passed: ${stage}.\n`),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runPhase93FreshCsrfVercelOneShotCli();
}

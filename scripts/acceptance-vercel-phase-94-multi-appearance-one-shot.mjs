import { pathToFileURL } from "node:url";

import {
  renderVercelOneShotPlan,
  runVercelOneShotCli,
  vercelOneShotConfirmation,
} from "./acceptance-vercel-one-shot.mjs";
import { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";
import {
  phase93FreshCsrfVercelCompletionIdentity,
  validatePhase93FreshCsrfVercelCompletion,
} from "./acceptance-vercel-phase-93-fresh-csrf-completion.mjs";

const stateIdentity = "phase-94-multi-appearance-ui";
const historicalStateIdentity = "phase-93-0023-fresh-csrf";
const stages = new Set([
  "observe-api-arm",
  "observe-web-arm",
  "preflight",
  "verify-api-disarm",
  "verify-web-disarm",
]);

export const phase94MultiAppearanceVercelOneShotConfirmation =
  "--confirm-hosted-vercel-phase-94-multi-appearance-ui-serial-one-shot-neil0619s-projects";
export const phase94MultiAppearanceVercelOneShotBaselines = Object.freeze({
  api: Object.freeze({
    count: 20,
    latestCommit: phase93FreshCsrfVercelCompletionIdentity.apiDeployment.sha,
    latestDeploymentId: phase93FreshCsrfVercelCompletionIdentity.apiDeployment.id,
  }),
  web: Object.freeze({
    count: 13,
    latestCommit: phase93FreshCsrfVercelCompletionIdentity.webDeployment.sha,
    latestDeploymentId: phase93FreshCsrfVercelCompletionIdentity.webDeployment.id,
  }),
});

function normalizeArguments(arguments_) {
  if (arguments_.length === 3 && arguments_[1] === "--") return [arguments_[0], arguments_[2]];
  return arguments_;
}

export function renderPhase94MultiAppearanceVercelOneShotPlan() {
  return [
    "Hosted Phase 94 multi-appearance UI API/Web serial deployment gate (zero write plan)",
    "Independent state: artifacts/hosted-vercel-one-shot/phase-94-multi-appearance-ui-state.json.",
    "Historical phase-93-0023-fresh-csrf-state.json remains immutable and must verify as exact complete.",
    "The current candidate 20 API / 13 Web non-Canceled baseline is pinned to that completion.",
    "It is not Hosted evidence until the independent Phase 94 diagnose is exact.",
    "Each API/Web arm and disarm remains a separately approved commit and push.",
    renderVercelOneShotPlan(phase94MultiAppearanceVercelOneShotBaselines),
  ].join("\n");
}

export async function runPhase94MultiAppearanceVercelOneShotCli({
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
    writeOutput(renderPhase94MultiAppearanceVercelOneShotPlan());
    return 0;
  }
  const stage = arguments_.length === 2 ? arguments_[0] : null;
  if (
    stage === null ||
    !stages.has(stage) ||
    arguments_[1] !== phase94MultiAppearanceVercelOneShotConfirmation
  ) {
    writeError("Hosted Phase 94 multi-appearance Vercel one-shot gate failed.\n");
    return 1;
  }
  try {
    const completionStore =
      historicalStateStore ??
      createVercelOneShotStateStore({
        repositoryRoot,
        stateIdentity: historicalStateIdentity,
      });
    validatePhase93FreshCsrfVercelCompletion(await completionStore.read());
  } catch {
    writeError("Hosted Phase 94 multi-appearance Vercel one-shot gate failed.\n");
    return 1;
  }
  return runVercelOneShotCli({
    ...dependencies,
    arguments_: [stage, vercelOneShotConfirmation],
    expectedBaselines: phase94MultiAppearanceVercelOneShotBaselines,
    repositoryRoot,
    stateStore:
      stateStore ??
      createVercelOneShotStateStore({
        repositoryRoot,
        stateIdentity,
      }),
    writeError: () => writeError("Hosted Phase 94 multi-appearance Vercel one-shot gate failed.\n"),
    writeOutput: () =>
      writeOutput(`Hosted Phase 94 multi-appearance Vercel one-shot gate passed: ${stage}.\n`),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runPhase94MultiAppearanceVercelOneShotCli();
}

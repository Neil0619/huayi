import { pathToFileURL } from "node:url";

import {
  renderVercelOneShotPlan,
  runVercelOneShotCli,
  vercelOneShotConfirmation,
} from "./acceptance-vercel-one-shot.mjs";
import { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";

const phase93StateIdentity = "phase-93-0023";
const stages = new Set([
  "observe-api-arm",
  "observe-web-arm",
  "preflight",
  "verify-api-disarm",
  "verify-web-disarm",
]);

export const phase93VercelOneShotConfirmation =
  "--confirm-hosted-vercel-phase-93-0023-serial-one-shot-neil0619s-projects";
export const phase93VercelOneShotBaselines = Object.freeze({
  api: Object.freeze({
    count: 18,
    latestCommit: "ca6f5bdf9f356b7f6a0f5c56b6e9af52e225b1a8",
    latestDeploymentId: "dpl_H4mWYY3dWd42VVw7FWidTcc3Cwu5",
  }),
  web: Object.freeze({
    count: 11,
    latestCommit: "b044dda6b9a4626aa54d962acceb23efb1c4520a",
    latestDeploymentId: "dpl_FQopGTKEn7QJLVTTLo86bGJfuWx1",
  }),
});

function normalizeArguments(arguments_) {
  if (arguments_.length === 3 && arguments_[1] === "--") return [arguments_[0], arguments_[2]];
  return arguments_;
}

export function renderPhase93VercelOneShotPlan() {
  return [
    "Hosted Phase 93 Vercel API/Web serial one-shot gate (zero write plan)",
    "Independent state: artifacts/hosted-vercel-one-shot/phase-93-0023-state.json.",
    "Phase 81 and Phase 92 state remain immutable and may coexist in the private directory.",
    "The candidate 18 API / 11 Web non-Canceled baseline comes from the Phase 92 terminal state.",
    "It is not Hosted evidence until the independent fresh diagnose is exact.",
    "Each API/Web arm and disarm remains a separately approved commit and push.",
    renderVercelOneShotPlan(phase93VercelOneShotBaselines),
  ].join("\n");
}

export async function runPhase93VercelOneShotCli({
  arguments_ = process.argv.slice(2),
  repositoryRoot = process.cwd(),
  stateStore,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
  ...dependencies
} = {}) {
  arguments_ = normalizeArguments(arguments_);
  if (arguments_.length === 1 && arguments_[0] === "plan") {
    writeOutput(renderPhase93VercelOneShotPlan());
    return 0;
  }
  const stage = arguments_.length === 2 ? arguments_[0] : null;
  if (stage === null || !stages.has(stage) || arguments_[1] !== phase93VercelOneShotConfirmation) {
    writeError("Hosted Phase 93 Vercel one-shot gate failed.\n");
    return 1;
  }
  return runVercelOneShotCli({
    ...dependencies,
    arguments_: [stage, vercelOneShotConfirmation],
    expectedBaselines: phase93VercelOneShotBaselines,
    repositoryRoot,
    stateStore:
      stateStore ??
      createVercelOneShotStateStore({ repositoryRoot, stateIdentity: phase93StateIdentity }),
    writeError: () => writeError("Hosted Phase 93 Vercel one-shot gate failed.\n"),
    writeOutput: () => writeOutput(`Hosted Phase 93 Vercel one-shot gate passed: ${stage}.\n`),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runPhase93VercelOneShotCli();
}

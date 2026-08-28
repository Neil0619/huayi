import { pathToFileURL } from "node:url";

import {
  renderVercelOneShotPlan,
  runVercelOneShotCli,
  vercelOneShotConfirmation,
} from "./acceptance-vercel-one-shot.mjs";
import { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";

const phase92StateIdentity = "phase-92-0022";
const stages = new Set([
  "observe-api-arm",
  "observe-web-arm",
  "preflight",
  "verify-api-disarm",
  "verify-web-disarm",
]);

export const phase92VercelOneShotConfirmation =
  "--confirm-hosted-vercel-phase-92-0022-serial-one-shot-neil0619s-projects";
export const phase92VercelOneShotBaselines = Object.freeze({
  api: Object.freeze({
    count: 17,
    latestCommit: "da733e172cc5859a4b9aea61c2e87a239e6843ed",
    latestDeploymentId: "dpl_AWUiTdYGgmVHZ127xqGAVhQb2zCd",
  }),
  web: Object.freeze({
    count: 10,
    latestCommit: "699fbe6c134c0b83347e0de3ce7c76dc4d520790",
    latestDeploymentId: "dpl_J6vtHUqfkstdGZ5w1yZJyVbhF6Yc",
  }),
});

function normalizeArguments(arguments_) {
  if (arguments_.length === 3 && arguments_[1] === "--") {
    return [arguments_[0], arguments_[2]];
  }
  return arguments_;
}

export function renderPhase92VercelOneShotPlan() {
  return [
    "Hosted Phase 92 Vercel API/Web serial one-shot gate (zero write plan)",
    "Independent state: artifacts/hosted-vercel-one-shot/phase-92-0022-state.json.",
    "Phase 81 state remains immutable and may coexist in the same private directory.",
    "The Phase 91 terminal 17 API / 10 Web non-Canceled baseline is reverified before Phase 92 starts.",
    "Each API/Web arm and disarm remains a separately approved commit and push.",
    renderVercelOneShotPlan(phase92VercelOneShotBaselines),
  ].join("\n");
}

export async function runPhase92VercelOneShotCli({
  arguments_ = process.argv.slice(2),
  repositoryRoot = process.cwd(),
  stateStore,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
  ...dependencies
} = {}) {
  arguments_ = normalizeArguments(arguments_);
  if (arguments_.length === 1 && arguments_[0] === "plan") {
    writeOutput(renderPhase92VercelOneShotPlan());
    return 0;
  }
  const stage = arguments_.length === 2 ? arguments_[0] : null;
  if (stage === null || !stages.has(stage) || arguments_[1] !== phase92VercelOneShotConfirmation) {
    writeError("Hosted Phase 92 Vercel one-shot gate failed.\n");
    return 1;
  }

  return runVercelOneShotCli({
    ...dependencies,
    arguments_: [stage, vercelOneShotConfirmation],
    expectedBaselines: phase92VercelOneShotBaselines,
    repositoryRoot,
    stateStore:
      stateStore ??
      createVercelOneShotStateStore({ repositoryRoot, stateIdentity: phase92StateIdentity }),
    writeError: () => writeError("Hosted Phase 92 Vercel one-shot gate failed.\n"),
    writeOutput: () => writeOutput(`Hosted Phase 92 Vercel one-shot gate passed: ${stage}.\n`),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runPhase92VercelOneShotCli();
}

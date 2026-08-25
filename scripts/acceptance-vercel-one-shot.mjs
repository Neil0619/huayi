import { pathToFileURL } from "node:url";

import {
  advanceVercelOneShotState,
  validateVercelOneShotStoredState,
} from "./acceptance-vercel-one-shot-contract.mjs";
import { renderVercelOneShotPlan } from "./acceptance-vercel-one-shot-config.mjs";
import { inspectVercelOneShotGit } from "./acceptance-vercel-one-shot-git.mjs";
import { readVercelOneShotSnapshot } from "./acceptance-vercel-one-shot-remote.mjs";
import { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";

export {
  expectedVercelOneShotBaselines,
  renderVercelOneShotPlan,
} from "./acceptance-vercel-one-shot-config.mjs";
export {
  advanceVercelOneShotState,
  validateVercelOneShotStoredState,
} from "./acceptance-vercel-one-shot-contract.mjs";
export { inspectVercelOneShotGit } from "./acceptance-vercel-one-shot-git.mjs";
export { readVercelOneShotSnapshot } from "./acceptance-vercel-one-shot-remote.mjs";
export { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";

export const vercelOneShotConfirmation =
  "--confirm-hosted-vercel-serial-one-shot-neil0619s-projects";

const stages = new Set([
  "observe-api-arm",
  "observe-web-arm",
  "preflight",
  "verify-api-disarm",
  "verify-web-disarm",
]);

function normalizeArguments(arguments_) {
  if (arguments_.length === 3 && arguments_[1] === "--") {
    return [arguments_[0], arguments_[2]];
  }
  return arguments_;
}

export async function runVercelOneShotCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
  inspectGit_ = inspectVercelOneShotGit,
  readSnapshot_ = readVercelOneShotSnapshot,
  repositoryRoot = process.cwd(),
  stateStore = createVercelOneShotStateStore({ repositoryRoot }),
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  arguments_ = normalizeArguments(arguments_);
  if (arguments_.length === 1 && arguments_[0] === "plan") {
    writeOutput(renderVercelOneShotPlan());
    return 0;
  }
  if (
    arguments_.length !== 2 ||
    !stages.has(arguments_[0]) ||
    arguments_[1] !== vercelOneShotConfirmation
  ) {
    writeError("Hosted Vercel one-shot gate failed.\n");
    return 1;
  }
  const stage = arguments_[0];
  try {
    const state = await stateStore.read();
    if ((stage === "preflight") !== (state === undefined)) throw new Error("invalid state");
    if (state !== undefined) validateVercelOneShotStoredState(state, stage);
    const git = await inspectGit_({ repositoryRoot });
    const snapshot = await readSnapshot_({ fetch_, token: environment.VERCEL_TOKEN });
    const nextState = advanceVercelOneShotState({ git, snapshot, stage, state });
    await stateStore.write(nextState);
    writeOutput(`Hosted Vercel one-shot gate passed: ${stage}.\n`);
    return 0;
  } catch {
    writeError("Hosted Vercel one-shot gate failed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runVercelOneShotCli();
}

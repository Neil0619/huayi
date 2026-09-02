import { pathToFileURL } from "node:url";

import { runHostedDeepSeekOneShotCli } from "./acceptance-hosted-deepseek-one-shot-plan.mjs";
import { createHostedDeepSeekProductionExecutorForCommand } from "./acceptance-hosted-deepseek-one-shot-production.mjs";

export function runHostedDeepSeekProductionCli({
  arguments_ = process.argv.slice(2),
  createProductionExecutor = createHostedDeepSeekProductionExecutorForCommand,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  return runHostedDeepSeekOneShotCli({
    arguments_,
    createProductionExecutor: () =>
      createProductionExecutor({ command: arguments_[0], environment: process.env }),
    writeError,
    writeOutput,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeepSeekProductionCli();
}

import { pathToFileURL } from "node:url";

import { runHostedRestoreFictionalArchive } from "./acceptance-hosted-restore-drill-fictional-runtime.mjs";

export const hostedRestoreFictionalConfirmation =
  "--confirm-networkless-fictional-pg17-full-archive-restore";

export async function runHostedRestoreFictionalCli({
  arguments_ = process.argv.slice(2),
  runFictionalArchive = runHostedRestoreFictionalArchive,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length !== 1 || arguments_[0] !== hostedRestoreFictionalConfirmation) {
    writeError("Hosted restore-drill fictional PG17 archive verification failed closed.\n");
    return 1;
  }
  try {
    await runFictionalArchive();
    writeOutput("Hosted restore-drill fictional PG17 archive verification passed.\n");
    return 0;
  } catch {
    writeError("Hosted restore-drill fictional PG17 archive verification failed closed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedRestoreFictionalCli();
}

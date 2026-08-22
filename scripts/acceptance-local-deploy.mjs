import { pathToFileURL } from "node:url";

import { buildAcceptanceLocal } from "./acceptance-local-build.mjs";
import { runPersistentDev } from "./acceptance-local-dev-lifecycle.mjs";
import { verifyAcceptanceRuntime } from "./acceptance-local-runtime.mjs";

export const LOCAL_DEPLOY_CONFIRMATION = "--confirm-local-downtime";

export async function deployAcceptanceLocal({
  arguments_ = [],
  build = () => buildAcceptanceLocal({ quiet: true }),
  startDev = () => runPersistentDev("start"),
  stopDev = () => runPersistentDev("stop"),
  verifyRuntime = verifyAcceptanceRuntime,
} = {}) {
  if (arguments_.length !== 1 || arguments_[0] !== LOCAL_DEPLOY_CONFIRMATION) {
    return "confirmation-required";
  }
  try {
    if (!(await verifyRuntime())) return "failed";
    if (!(await stopDev())) return "failed";
    if ((await build()) !== 0) return "failed";
    if (!(await startDev())) return "failed";
    return "succeeded";
  } catch {
    return "failed";
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deployAcceptanceLocal({ arguments_: process.argv.slice(2) })
    .then((result) => {
      if (result === "succeeded") {
        process.stdout.write("Local acceptance deployment completed.\n");
        return;
      }
      process.stderr.write(
        result === "confirmation-required"
          ? `Local acceptance deployment requires ${LOCAL_DEPLOY_CONFIRMATION}.\n`
          : "Local acceptance deployment failed. Check local service status before retrying.\n",
      );
      process.exitCode = 1;
    })
    .catch(() => {
      process.stderr.write(
        "Local acceptance deployment failed. Check local service status before retrying.\n",
      );
      process.exitCode = 1;
    });
}

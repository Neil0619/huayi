import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { bootstrapAcceptanceLocal } from "./acceptance-local-bootstrap.mjs";
import { buildAcceptanceLocal } from "./acceptance-local-build.mjs";
import { runPersistentDev } from "./acceptance-local-dev-lifecycle.mjs";
import { ACCEPTANCE_LOCAL_NETWORK, verifyAcceptanceRuntime } from "./acceptance-local-runtime.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseEntrypoint = resolve(repositoryRoot, "node_modules/supabase/dist/supabase.js");

export const LOCAL_RESET_CONFIRMATION = "--confirm-local-data-loss";

function runCommand(command, arguments_) {
  return new Promise((resolveResult) => {
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolveResult({ code: null, stdout: "" }));
    child.once("exit", (code, signal) =>
      resolveResult({ code: signal === null ? code : null, stdout: "" }),
    );
  });
}

export async function resetLocalDatabase({ run = runCommand } = {}) {
  const result = await run(process.execPath, [
    supabaseEntrypoint,
    "db",
    "reset",
    "--local",
    "--yes",
    "--sql-paths",
    "seed.sql",
    "--network-id",
    ACCEPTANCE_LOCAL_NETWORK,
    "--output",
    "json",
  ]);
  return result.code === 0;
}

export async function resetAcceptanceLocal({
  arguments_ = [],
  bootstrap = async () => {
    await bootstrapAcceptanceLocal();
    return true;
  },
  build = () => buildAcceptanceLocal({ quiet: true }),
  resetDatabase = resetLocalDatabase,
  startDev = () => runPersistentDev("start"),
  stopDev = () => runPersistentDev("stop"),
  verifyRuntime = verifyAcceptanceRuntime,
}) {
  if (arguments_.length !== 1 || arguments_[0] !== LOCAL_RESET_CONFIRMATION) {
    return "confirmation-required";
  }
  try {
    if (!(await verifyRuntime())) return "failed";
    if (!(await stopDev())) return "failed";
    if (!(await resetDatabase())) return "failed";
    if (!(await verifyRuntime())) return "failed";
    if ((await bootstrap()) !== true) return "failed";
    if ((await build()) !== 0) return "failed";
    if (!(await startDev())) return "failed";
    return "succeeded";
  } catch {
    return "failed";
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  resetAcceptanceLocal({ arguments_: process.argv.slice(2) })
    .then((result) => {
      if (result === "succeeded") {
        process.stdout.write(
          "Local acceptance reset completed. Create a new invitation before registering.\n",
        );
        return;
      }
      process.stderr.write(
        result === "confirmation-required"
          ? `Local acceptance reset requires ${LOCAL_RESET_CONFIRMATION}.\n`
          : "Local acceptance reset failed. Check local service status before retrying.\n",
      );
      process.exitCode = 1;
    })
    .catch(() => {
      process.stderr.write(
        "Local acceptance reset failed. Check local service status before retrying.\n",
      );
      process.exitCode = 1;
    });
}

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const diagnosticPath = fileURLToPath(
  new URL("../apps/native-host/dist/diagnostics/run-compatible-smoke.js", import.meta.url),
);

export function runCompatibleSmokeWrapper({
  arguments: arguments_,
  existsSync: pathExists,
  spawnSync: spawn,
  writeError,
}) {
  if (arguments_.length !== 0) {
    writeError("Compatible smoke does not accept arguments; it uses fixed cases.\n");
    return 1;
  }
  if (!pathExists(diagnosticPath)) {
    writeError("Compatible smoke diagnostic build is missing. Run pnpm build first.\n");
    return 1;
  }

  writeError(
    "WARNING: API credentials and selected text use plaintext HTTP; this smoke may incur third-party API charges.\n",
  );
  const result = spawn(process.execPath, [diagnosticPath], { stdio: "inherit" });
  return result.status ?? 1;
}

function isDirectExecution() {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url;
}

if (isDirectExecution()) {
  process.exitCode = runCompatibleSmokeWrapper({
    arguments: process.argv.slice(2),
    existsSync,
    spawnSync,
    writeError: (line) => process.stderr.write(line),
  });
}

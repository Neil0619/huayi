import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const diagnosticPath = fileURLToPath(
  new URL("../apps/native-host/dist/diagnostics/compare-providers.js", import.meta.url),
);

export function runComparisonWrapper({
  arguments: arguments_,
  existsSync: pathExists,
  spawnSync: spawn,
  writeError,
}) {
  if (arguments_.length !== 0) {
    writeError(
      "Provider comparison does not accept arguments; it uses fixed profiles and cases.\n",
    );
    return 1;
  }
  if (!pathExists(diagnosticPath)) {
    writeError("Provider comparison diagnostic build is missing. Run pnpm build first.\n");
    return 1;
  }

  writeError(
    "Warning: provider comparison can consume ChatGPT/Codex quota and incur OpenAI API charges.\n",
  );
  const result = spawn(process.execPath, [diagnosticPath], { stdio: "inherit" });
  return result.status ?? 1;
}

function isDirectExecution() {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url;
}

if (isDirectExecution()) {
  process.exitCode = runComparisonWrapper({
    arguments: process.argv.slice(2),
    existsSync,
    spawnSync,
    writeError: (line) => process.stderr.write(line),
  });
}

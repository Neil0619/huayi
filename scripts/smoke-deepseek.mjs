import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const diagnosticPath = fileURLToPath(
  new URL("../apps/native-host/dist/diagnostics/run-deepseek-smoke.js", import.meta.url),
);

export function runDeepSeekSmokeWrapper({
  arguments: arguments_,
  existsSync: pathExists,
  spawnSync: spawn,
  writeError,
}) {
  if (arguments_.length !== 0) {
    writeError("DeepSeek smoke does not accept arguments; it uses fixed cases.\n");
    return 1;
  }
  if (!pathExists(diagnosticPath)) {
    writeError("DeepSeek smoke diagnostic build is missing. Run pnpm build first.\n");
    return 1;
  }
  writeError(
    "WARNING: this sends fixed English test text to the official DeepSeek API and may incur API charges.\n",
  );
  const result = spawn(process.execPath, [diagnosticPath], { stdio: "inherit" });
  return result.status ?? 1;
}

function isDirectExecution() {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url;
}

if (isDirectExecution()) {
  process.exitCode = runDeepSeekSmokeWrapper({
    arguments: process.argv.slice(2),
    existsSync,
    spawnSync,
    writeError: (line) => process.stderr.write(line),
  });
}

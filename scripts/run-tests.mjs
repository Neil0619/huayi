import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDirectory = resolve(repositoryRoot, "scripts");

export async function listScriptTests() {
  const entries = await readdir(scriptsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => `scripts/${entry.name}`)
    .sort();
}

function createVitestStep(pnpmEntry, project, extraArguments = []) {
  return {
    arguments: [
      pnpmEntry,
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.config.ts",
      "--passWithNoTests",
      ...(project === undefined ? [] : ["--project", project]),
      ...extraArguments,
    ],
    executable: process.execPath,
  };
}

function resolveTestSteps(scriptTests, pnpmEntry, platform) {
  if (pnpmEntry === undefined || pnpmEntry.length === 0) {
    throw new Error("Repository tests must be started through pnpm.");
  }
  const scriptStep = {
    arguments: ["--test", ...scriptTests],
    executable: process.execPath,
  };
  if (platform !== "win32") {
    return [scriptStep, createVitestStep(pnpmEntry, undefined, ["--maxWorkers", "4"])];
  }
  return [
    scriptStep,
    createVitestStep(pnpmEntry, "store-domain"),
    createVitestStep(pnpmEntry, "learning-domain"),
    createVitestStep(pnpmEntry, "cloud-contracts"),
    createVitestStep(pnpmEntry, "protocol"),
    createVitestStep(pnpmEntry, "native-host", ["--no-file-parallelism"]),
    createVitestStep(pnpmEntry, "extension"),
    createVitestStep(pnpmEntry, "store-extension"),
  ];
}

async function runStep(step) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(step.executable, step.arguments, {
      cwd: repositoryRoot,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else reject(new Error("Repository test step failed."));
    });
  });
}

export async function runRepositoryTests({
  listTests = listScriptTests,
  mode = "all",
  platform = process.platform,
  pnpmEntry = process.env.npm_execpath,
  run = runStep,
} = {}) {
  const scriptTests = await listTests();
  if (scriptTests.length === 0) throw new Error("No script tests were found.");
  if (!new Set(["all", "scripts-only", "vitest-only"]).has(mode)) {
    throw new Error("Repository test mode is invalid.");
  }
  const steps = resolveTestSteps(scriptTests, pnpmEntry, platform);
  const selected =
    mode === "scripts-only" ? [steps[0]] : mode === "vitest-only" ? steps.slice(1) : steps;
  for (const step of selected) await run(step);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const modeArgument = process.argv[2];
  const mode =
    modeArgument === undefined
      ? "all"
      : modeArgument === "--scripts-only"
        ? "scripts-only"
        : modeArgument === "--vitest-only"
          ? "vitest-only"
          : "invalid";
  if (process.argv.length > (modeArgument === undefined ? 2 : 3)) {
    process.stderr.write("Repository test mode is invalid.\n");
    process.exitCode = 1;
  } else
    runRepositoryTests({ mode }).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Tests failed."}\n`);
      process.exitCode = 1;
    });
}

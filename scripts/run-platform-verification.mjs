import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const sharedSteps = [
  { arguments: ["check:instructions"], command: "pnpm" },
  { arguments: ["format:check"], command: "pnpm" },
  { arguments: ["lint"], command: "pnpm" },
  { arguments: ["typecheck"], command: "pnpm" },
  { arguments: ["test"], command: "pnpm" },
];

export function platformVerificationSteps(platform) {
  if (platform === "darwin") {
    return [
      ...sharedSteps,
      { arguments: ["test:e2e"], command: "pnpm" },
      { arguments: ["build"], command: "pnpm" },
      { arguments: ["diff", "--check"], command: "git" },
    ];
  }
  if (platform === "win32") {
    return [
      ...sharedSteps,
      { arguments: ["build"], command: "pnpm" },
      { arguments: ["host:windows:package"], command: "pnpm" },
      { arguments: ["scripts/verify-windows-sea.mjs"], command: "node" },
      { arguments: ["diff", "--check"], command: "git" },
    ];
  }
  throw new Error("Platform verification supports only macOS and Windows.");
}

function platformName(platform) {
  return platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : platform;
}

function resolveInvocation(step) {
  if (step.command === "node") {
    return { arguments: step.arguments, executable: process.execPath };
  }
  if (step.command === "pnpm") {
    const pnpmEntry = process.env.npm_execpath;
    if (pnpmEntry === undefined || pnpmEntry.length === 0) {
      throw new Error("pnpm verification must be started through a pnpm package script.");
    }
    return { arguments: [pnpmEntry, ...step.arguments], executable: process.execPath };
  }
  return { arguments: step.arguments, executable: step.command };
}

async function runStepWithChildProcess(step) {
  const invocation = resolveInvocation(step);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.executable, invocation.arguments, {
      cwd: repositoryRoot,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else reject(new Error(`${step.command} ${step.arguments.join(" ")} failed.`));
    });
  });
}

export async function runPlatformVerification({
  actualPlatform = process.platform,
  expectedPlatform,
  runStep = runStepWithChildProcess,
}) {
  platformVerificationSteps(expectedPlatform);
  if (actualPlatform !== expectedPlatform) {
    throw new Error(
      `${platformName(expectedPlatform)} verification requires ${platformName(expectedPlatform)}.`,
    );
  }
  for (const step of platformVerificationSteps(expectedPlatform)) {
    await runStep(step);
  }
}

async function main() {
  const expectedPlatform = process.argv[2];
  if (expectedPlatform !== "darwin" && expectedPlatform !== "win32") {
    throw new Error("Expected verification platform darwin or win32.");
  }
  await runPlatformVerification({ expectedPlatform });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Verification failed."}\n`);
    process.exitCode = 1;
  });
}

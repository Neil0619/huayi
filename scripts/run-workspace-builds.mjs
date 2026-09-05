import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const workspaceBuildDirectories = Object.freeze([
  "packages/learning-domain",
  "packages/cloud-contracts",
  "packages/protocol",
  "packages/store-domain",
  "apps/api",
  "apps/web",
  "apps/extension",
  "apps/native-host",
  "apps/store-extension",
]);

function resolvePnpmInvocation(directory) {
  const pnpmEntry = process.env.npm_execpath;
  if (pnpmEntry === undefined || pnpmEntry.length === 0) {
    throw new Error("Workspace build must be started through pnpm.");
  }
  return {
    arguments: [pnpmEntry, "--dir", directory, "build"],
    executable: process.execPath,
  };
}

async function runWorkspace(directory, environment) {
  const invocation = resolvePnpmInvocation(directory);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.executable, invocation.arguments, {
      cwd: repositoryRoot,
      env: environment,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else reject(new Error(`Workspace build failed: ${directory}`));
    });
  });
}

export async function runWorkspaceBuilds(run = runWorkspace, environment = process.env) {
  for (const directory of workspaceBuildDirectories) {
    await run(
      directory,
      directory === "apps/store-extension"
        ? { ...environment, HUAYI_STORE_BUILD_PROFILE: "release" }
        : environment,
    );
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWorkspaceBuilds().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Build failed."}\n`);
    process.exitCode = 1;
  });
}

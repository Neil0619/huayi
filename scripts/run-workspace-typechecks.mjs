import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const workspaceTypecheckDirectories = Object.freeze([
  "packages/protocol",
  "apps/extension",
  "apps/native-host",
]);

function resolvePnpmInvocation(directory) {
  const pnpmEntry = process.env.npm_execpath;
  if (pnpmEntry === undefined || pnpmEntry.length === 0) {
    throw new Error("Workspace typecheck must be started through pnpm.");
  }
  return {
    arguments: [pnpmEntry, "--dir", directory, "typecheck"],
    executable: process.execPath,
  };
}

async function runWorkspace(directory) {
  const invocation = resolvePnpmInvocation(directory);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.executable, invocation.arguments, {
      cwd: repositoryRoot,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else reject(new Error(`Workspace typecheck failed: ${directory}`));
    });
  });
}

export async function runWorkspaceTypechecks(run = runWorkspace) {
  for (const directory of workspaceTypecheckDirectories) {
    await run(directory);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWorkspaceTypechecks().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Typecheck failed."}\n`);
    process.exitCode = 1;
  });
}

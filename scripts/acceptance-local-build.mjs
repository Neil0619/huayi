import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const ACCEPTANCE_LOCAL_BUILD_ORDER = Object.freeze([
  "@huayi/learning-domain",
  "@huayi/cloud-contracts",
  "@huayi/api",
  "@huayi/web",
]);

function runPnpm(arguments_, environment = process.env, { quiet = false } = {}) {
  return new Promise((resolveResult) => {
    const child = spawn("pnpm", arguments_, {
      cwd: repositoryRoot,
      env: environment,
      shell: false,
      stdio: quiet ? "ignore" : "inherit",
      windowsHide: true,
    });
    child.once("error", () => resolveResult(false));
    child.once("exit", (code, signal) => resolveResult(code === 0 && signal === null));
  });
}

async function webApiOrigin() {
  const contents = await readFile(resolve(repositoryRoot, ".env.acceptance.local"), "utf8");
  const line = contents.split(/\r?\n/u).find((value) => value.startsWith("VITE_API_ORIGIN="));
  const value = line?.slice("VITE_API_ORIGIN=".length);
  if (value !== "https://api.acceptance.localhost:8444") {
    throw new Error("Local acceptance Web origin is invalid.");
  }
  return value;
}

export async function buildAcceptanceLocal({ quiet = false } = {}) {
  for (const packageName of ACCEPTANCE_LOCAL_BUILD_ORDER) {
    const environment =
      packageName === "@huayi/web"
        ? {
            ...process.env,
            VITE_ACCEPTANCE_MODEL: "simulated",
            VITE_API_ORIGIN: await webApiOrigin(),
          }
        : process.env;
    if (!(await runPnpm(["--filter", packageName, "build"], environment, { quiet }))) return 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildAcceptanceLocal()
    .then((exitCode) => {
      if (exitCode === 0) process.stdout.write("Local acceptance bundles are ready.\n");
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write("Local acceptance build failed.\n");
      process.exitCode = 1;
    });
}

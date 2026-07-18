import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MINIMUM_NODE_MAJOR = 26;

export function createSeaConfiguration(rootDirectory) {
  return {
    disableExperimentalSEAWarning: true,
    main: resolve(rootDirectory, "apps/native-host/dist/windows/sea-main.cjs"),
    output: resolve(rootDirectory, "apps/native-host/dist/windows/huayi-native-host.exe"),
    useCodeCache: false,
    useSnapshot: false,
  };
}

export function assertWindowsSeaRuntime(platform, nodeVersion) {
  if (platform !== "win32")
    throw new Error("The Windows Host executable must be packaged on Windows.");
  const major = Number.parseInt(nodeVersion.split(".")[0] ?? "", 10);
  if (!Number.isSafeInteger(major) || major < MINIMUM_NODE_MAJOR) {
    throw new Error("Windows Host packaging requires Node.js 26 or newer.");
  }
}

async function run(executable, arguments_, cwd) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, { cwd, shell: false, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else reject(new Error("Windows Host packaging failed."));
    });
  });
}

async function main() {
  assertWindowsSeaRuntime(process.platform, process.versions.node);
  const rootDirectory = process.cwd();
  const configuration = createSeaConfiguration(rootDirectory);
  const configurationPath = resolve(rootDirectory, "apps/native-host/dist/windows/sea-config.json");
  await writeFile(configurationPath, `${JSON.stringify(configuration, null, 2)}\n`, "utf8");
  await run(process.execPath, ["--build-sea", configurationPath], rootDirectory);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Windows Host packaging failed."}\n`,
    );
    process.exitCode = 1;
  });
}

import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { assertWindowsSeaRuntime } from "./build-windows-host.mjs";

export function createSeaProbeConfiguration(directory) {
  return {
    disableExperimentalSEAWarning: true,
    main: join(directory, "probe.cjs"),
    output: join(directory, "probe.exe"),
    useCodeCache: false,
    useSnapshot: false,
  };
}

async function run(executable, arguments_, cwd) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, { cwd, shell: false, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else reject(new Error("Windows SEA builder smoke failed."));
    });
  });
}

async function main() {
  assertWindowsSeaRuntime(process.platform, process.versions.node);
  const directory = await mkdtemp(join(tmpdir(), "huayi-sea-builder-"));
  try {
    const configuration = createSeaProbeConfiguration(directory);
    const configurationPath = join(directory, "sea-config.json");
    await writeFile(configuration.main, "process.exitCode = 0;\n", "utf8");
    await writeFile(configurationPath, `${JSON.stringify(configuration, null, 2)}\n`, "utf8");
    await run(process.execPath, ["--build-sea", configurationPath], directory);
    await access(configuration.output);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Windows SEA builder smoke failed."}\n`,
    );
    process.exitCode = 1;
  });
}

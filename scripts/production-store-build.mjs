import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { auditStoreRelease } from "./check-store-release.mjs";
import { readStoreCloudBuild } from "./store-cloud-build.mjs";

export const productionStoreExtensionId = "enlolhfodncfnleiihkjanhmnfbgeggh";
const apiOrigin = "https://api.seen-said.cn";
const webOrigin = "https://app.seen-said.cn";
const expectedHosts = [
  "https://api.openai.com/*",
  "https://api.deepseek.com/*",
  "https://api.frdic.com/*",
  `${apiOrigin}/*`,
];

export async function auditProductionStorePackage(repositoryRoot) {
  const violations = await auditStoreRelease(repositoryRoot, {
    expectedHosts,
    expectedCsp: `script-src 'self'; object-src 'self'; connect-src ${expectedHosts.map((host) => host.slice(0, -2)).join(" ")}`,
    sourceManifestName: "manifest.production.json",
  });
  try {
    const root = resolve(repositoryRoot, "apps/store-extension/dist-production");
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
    const key =
      typeof manifest.key === "string" ? Buffer.from(manifest.key, "base64") : Buffer.alloc(0);
    const alphabet = "abcdefghijklmnop";
    const id = [...createHash("sha256").update(key).digest().subarray(0, 16)]
      .flatMap((byte) => [alphabet[byte >> 4], alphabet[byte & 15]])
      .join("");
    if (
      key.byteLength < 128 ||
      key.toString("base64") !== manifest.key ||
      id !== productionStoreExtensionId
    ) {
      violations.push("Production Store identity is invalid.");
    }
    const build = readStoreCloudBuild(repositoryRoot, "production");
    const worker = await readFile(resolve(root, "service-worker.js"), "utf8");
    if (
      !build.apiConsumed ||
      !build.workspaceConsumed ||
      build.apiOrigin !== apiOrigin ||
      build.webOrigin !== webOrigin ||
      build.workspaceUrl !== `${webOrigin}/app` ||
      !worker.includes(apiOrigin) ||
      !worker.includes(`${webOrigin}/app`) ||
      worker.includes("acceptance.seen-said.cn") ||
      /HUAYI_(?:CLOUD_API_ORIGIN|WEB_WORKSPACE_URL)_BUILD_VALUE/u.test(worker)
    ) {
      violations.push("Production Store endpoints are invalid.");
    }
  } catch {
    violations.push("Production Store package is unreadable.");
  }
  return [...new Set(violations)].sort();
}

function buildEnvironment(environment) {
  return {
    ...Object.fromEntries(
      [
        "CI",
        "HOME",
        "PATH",
        "SYSTEMROOT",
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "TMPDIR",
        "NO_COLOR",
      ].flatMap((name) =>
        typeof environment[name] === "string" ? [[name, environment[name]]] : [],
      ),
    ),
    HUAYI_STORE_BUILD_PROFILE: "production",
  };
}

export function runProductionStoreBuild({ environment, repositoryRoot }) {
  return new Promise((resolveResult) => {
    if (typeof environment.npm_execpath !== "string" || environment.npm_execpath.length === 0) {
      resolveResult(false);
      return;
    }
    const child = spawn(
      process.execPath,
      [environment.npm_execpath, "--filter", "@huayi/store-extension", "build"],
      {
        cwd: repositoryRoot,
        env: buildEnvironment(environment),
        shell: false,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", () => resolveResult(false));
    child.once("close", (code, signal) => resolveResult(code === 0 && signal === null));
  });
}

export async function runProductionStoreCli({
  arguments_ = process.argv.slice(2),
  repositoryRoot = process.cwd(),
  environment = process.env,
  runBuild = runProductionStoreBuild,
  audit = auditProductionStorePackage,
  writeOutput = (value) => process.stdout.write(value),
  writeError = (value) => process.stderr.write(value),
} = {}) {
  try {
    if (arguments_.length !== 1 || !new Set(["build", "status"]).has(arguments_[0]))
      throw new Error();
    if (
      arguments_[0] === "build" &&
      !(await runBuild({
        repositoryRoot,
        environment: { ...buildEnvironment(environment), npm_execpath: environment.npm_execpath },
      }))
    )
      throw new Error();
    if ((await audit(repositoryRoot)).length !== 0) throw new Error();
    writeOutput(
      `Production Store package verified: apps/store-extension/dist-production (${productionStoreExtensionId}).\n`,
    );
    return 0;
  } catch {
    writeError("Production Store package failed verification.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runProductionStoreCli();
}

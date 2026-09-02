import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { auditStoreRelease } from "./check-store-release.mjs";

export const hostedAcceptanceStoreApiOrigin = "https://api.acceptance.seen-said.cn";
export const hostedAcceptanceStoreWebWorkspaceUrl = "https://app.acceptance.seen-said.cn/app";
export const hostedAcceptanceStoreExtensionId = "hoijjhgcckfhbcefoclgbhkgninnkknd";

const failureMessage = "Hosted Store acceptance package failed closed.";
const repositoryRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const auditOptions = Object.freeze({
  expectedCsp:
    "script-src 'self'; object-src 'self'; connect-src https://api.openai.com https://api.deepseek.com https://api.frdic.com https://api.acceptance.seen-said.cn",
  expectedHosts: Object.freeze([
    "https://api.openai.com/*",
    "https://api.deepseek.com/*",
    "https://api.frdic.com/*",
    "https://api.acceptance.seen-said.cn/*",
  ]),
  sourceManifestName: "manifest.hosted-acceptance.json",
});

function safeBuildEnvironment(environment) {
  const allowedNames = ["CI", "HOME", "LOGNAME", "NO_COLOR", "PATH", "TERM", "TMPDIR", "USER"];
  return {
    ...Object.fromEntries(
      allowedNames.flatMap((name) =>
        typeof environment?.[name] === "string" ? [[name, environment[name]]] : [],
      ),
    ),
    HUAYI_STORE_BUILD_PROFILE: "hosted-acceptance",
  };
}

function extensionIdFromPublicKey(key) {
  if (typeof key !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(key)) return null;
  const material = Buffer.from(key, "base64");
  if (material.byteLength < 128 || material.toString("base64") !== key) return null;
  const alphabet = "abcdefghijklmnop";
  return [...createHash("sha256").update(material).digest().subarray(0, 16)]
    .flatMap((byte) => [alphabet[byte >> 4], alphabet[byte & 15]])
    .join("");
}

export function runHostedAcceptanceStoreBuild({
  arguments_,
  environment,
  repositoryRoot,
  spawnProcess = spawn,
} = {}) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawnProcess("pnpm", arguments_, {
        cwd: repositoryRoot,
        env: safeBuildEnvironment(environment),
        shell: false,
        stdio: "inherit",
        windowsHide: true,
      });
    } catch {
      resolveResult(false);
      return;
    }
    child.once("error", () => resolveResult(false));
    child.once("close", (code, signal) => resolveResult(code === 0 && signal === null));
  });
}

export async function auditHostedAcceptanceStorePackage(repositoryRoot, options = auditOptions) {
  const violations = await auditStoreRelease(repositoryRoot, options);
  try {
    const extensionRoot = resolve(repositoryRoot, "apps/store-extension");
    const [sourceText, packagedText, serviceWorker] = await Promise.all([
      readFile(resolve(extensionRoot, "manifest.hosted-acceptance.json"), "utf8"),
      readFile(resolve(extensionRoot, "dist/manifest.json"), "utf8"),
      readFile(resolve(extensionRoot, "dist/service-worker.js"), "utf8"),
    ]);
    const source = JSON.parse(sourceText);
    const packaged = JSON.parse(packagedText);
    if (
      extensionIdFromPublicKey(source.key) !== hostedAcceptanceStoreExtensionId ||
      source.key !== packaged.key
    ) {
      violations.push("Hosted acceptance Extension identity is invalid.");
    }
    if (
      !serviceWorker.includes(hostedAcceptanceStoreApiOrigin) ||
      !serviceWorker.includes(hostedAcceptanceStoreWebWorkspaceUrl) ||
      serviceWorker.includes("HUAYI_CLOUD_API_ORIGIN_BUILD_VALUE") ||
      serviceWorker.includes("HUAYI_WEB_WORKSPACE_URL_BUILD_VALUE")
    ) {
      violations.push("Hosted acceptance Store endpoints are invalid.");
    }
  } catch {
    violations.push("Hosted acceptance Store package is unreadable.");
  }
  return [...new Set(violations)].sort();
}

export async function runHostedAcceptanceStoreCli({
  arguments_ = process.argv.slice(2),
  auditStore = auditHostedAcceptanceStorePackage,
  environment = process.env,
  repositoryRoot = repositoryRootDefault,
  runBuild = runHostedAcceptanceStoreBuild,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      !new Set(["build", "status"]).has(arguments_[0]) ||
      typeof auditStore !== "function" ||
      typeof repositoryRoot !== "string" ||
      repositoryRoot.length === 0 ||
      typeof runBuild !== "function"
    ) {
      throw new Error(failureMessage);
    }
    if (
      arguments_[0] === "build" &&
      !(await runBuild({
        arguments_: ["--filter", "@huayi/store-extension", "build"],
        environment: safeBuildEnvironment(environment),
        repositoryRoot,
      }))
    ) {
      throw new Error(failureMessage);
    }
    if ((await auditStore(repositoryRoot, auditOptions)).length !== 0) {
      throw new Error(failureMessage);
    }
    writeOutput(
      "Hosted Store acceptance package is ready: apps/store-extension/dist " +
        `(Extension ID ${hostedAcceptanceStoreExtensionId}).\n`,
    );
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedAcceptanceStoreCli();
}

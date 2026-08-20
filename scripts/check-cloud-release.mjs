import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { auditStoreRelease } from "./check-store-release.mjs";

const BASE_STORE_HOSTS = [
  "https://api.openai.com/*",
  "https://api.deepseek.com/*",
  "https://api.frdic.com/*",
];
const BASE_CONNECT_SOURCES = [
  "https://api.openai.com",
  "https://api.deepseek.com",
  "https://api.frdic.com",
];
const SERVER_SECRET_MARKERS = [
  "CRON_SECRET",
  "HUAYI_DATABASE_URL",
  "HUAYI_DEEPSEEK_API_KEY",
  "HUAYI_REFRESH_ENCRYPTION_KEY",
  "HUAYI_SECRET_PEPPER",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const LEGACY_DISCLOSURE_MARKERS = ["端到端加密的本地生词本", "无账户、默认遥测或自有后端"];
const PHASE_27_DISCLOSURES = [
  /(?:账号偏好|三项账号选择)/u,
  /不自动(?:互相)?(?:回退|切换)/u,
  /(?:StudyCapture[^\n]{0,160}(?:原始|原文|学习意图)|(?:原始|原文|学习意图)[^\n]{0,160}StudyCapture)/u,
  /(?:本机词库[^\n]{0,160}CloudWordCopy|CloudWordCopy[^\n]{0,160}本机词库)/u,
];
const PHASE_27_LEGACY_IMPORT_MARKERS = [
  /\/v1\/analyses:import/iu,
  /pendingReview\s+import/iu,
  /登录后上传\s*BYOK\s*完整结果/iu,
  /BYOK\s*完整结果(?:上传|导入)/iu,
];
const SAFE_MESSAGES = {
  "development-blocker-missing":
    "Cloud development baseline is missing an expected release blocker.",
  "development-blocker-unexpected":
    "Cloud development baseline contains an unexpected release blocker.",
  "disclosure-drift": "Cloud listing does not match the candidate package and public origins.",
  "privacy-not-final": "The public privacy policy is still marked as a draft or pre-release.",
  "privacy-required-facts": "The public privacy policy is missing required Cloud data facts.",
  "phase-27-disclosure-required":
    "The public materials are missing required Phase 27 data-path facts.",
  "phase-27-legacy-import": "The public materials contain a removed BYOK analysis-import claim.",
  "release-config-api-extension-id": "Cloud release API Extension ID is missing or inconsistent.",
  "release-config-api-origin": "Cloud release API origin is missing or invalid.",
  "release-config-extension-id": "Cloud release Extension ID is missing or invalid.",
  "release-config-min-extension-version":
    "Cloud release minimum Extension version is missing or invalid.",
  "release-config-privacy-url": "Cloud release privacy URL is missing or invalid.",
  "release-config-web-origin": "Cloud release Web origin is missing or invalid.",
  "store-api-origin": "Store runtime API origin does not match the candidate.",
  "store-bundle-origin": "Store bundle does not contain the fixed candidate origins.",
  "store-client-version-policy": "Store candidate does not satisfy the minimum client version.",
  "store-package": "Store candidate package failed its reviewed package audit.",
  "store-web-workspace-url": "Store Web workspace URL does not match the candidate.",
  "web-privacy-artifact": "Web bundle does not contain the public privacy notice.",
  "web-remote-code": "Web candidate contains a remote or inline executable asset.",
  "web-server-secret": "Web candidate contains a server-only secret marker.",
};

export const CLOUD_DEVELOPMENT_BLOCKER_CODES = Object.freeze([
  "privacy-not-final",
  "release-config-api-extension-id",
  "release-config-api-origin",
  "release-config-extension-id",
  "release-config-min-extension-version",
  "release-config-privacy-url",
  "release-config-web-origin",
  "store-api-origin",
  "store-web-workspace-url",
]);

function violation(code) {
  return { code, message: SAFE_MESSAGES[code] };
}

function candidateOrigin(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      /\.(?:example|invalid|test)$/iu.test(parsed.hostname)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

function strictVersion(value) {
  if (typeof value !== "string" || !versionPattern.test(value)) return null;
  const parts = value.split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function configurationEvidence(configuration, violations) {
  const api = candidateOrigin(configuration.apiOrigin);
  const web = candidateOrigin(configuration.webOrigin);
  if (api === null) violations.push(violation("release-config-api-origin"));
  if (web === null || web?.origin === api?.origin) {
    violations.push(violation("release-config-web-origin"));
  }
  const extensionId =
    typeof configuration.extensionId === "string" && /^[a-p]{32}$/u.test(configuration.extensionId)
      ? configuration.extensionId
      : null;
  if (extensionId === null) {
    violations.push(violation("release-config-extension-id"));
  }
  const apiExtensionId =
    typeof configuration.apiExtensionId === "string" &&
    /^[a-p]{32}$/u.test(configuration.apiExtensionId)
      ? configuration.apiExtensionId
      : null;
  if (apiExtensionId === null || (extensionId !== null && apiExtensionId !== extensionId)) {
    violations.push(violation("release-config-api-extension-id"));
  }
  const minSupportedExtensionVersion = strictVersion(configuration.minSupportedExtensionVersion);
  if (minSupportedExtensionVersion === null) {
    violations.push(violation("release-config-min-extension-version"));
  }
  const privacy =
    typeof configuration.privacyUrl === "string"
      ? (() => {
          try {
            return new URL(configuration.privacyUrl);
          } catch {
            return null;
          }
        })()
      : null;
  if (
    privacy === null ||
    web === null ||
    privacy.href !== `${web.origin}/privacy` ||
    privacy.username !== "" ||
    privacy.password !== ""
  ) {
    violations.push(violation("release-config-privacy-url"));
  }
  return { api, minSupportedExtensionVersion, privacy, web };
}

function stringConstant(source, name) {
  const parsed = ts.createSourceFile("candidate.ts", source, ts.ScriptTarget.Latest, true);
  let result;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      result =
        node.initializer !== undefined &&
        (ts.isStringLiteral(node.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(node.initializer))
          ? node.initializer.text
          : null;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return result;
}

function toPosix(value) {
  return value.split(sep).join("/");
}

async function listFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path, base) : [toPosix(relative(base, path))];
    }),
  );
  return files.flat().sort();
}

function hasRemoteOrInlineCode(index) {
  return (
    /(?:src|href)\s*=\s*["'](?:https?:)?\/\//iu.test(index) ||
    /<script\b(?![^>]*\bsrc\s*=)[^>]*>/iu.test(index) ||
    /\son[a-z]+\s*=/iu.test(index)
  );
}

async function auditStore(root, api, web, minSupportedExtensionVersion, violations) {
  let candidateVersion = null;
  try {
    const manifest = JSON.parse(
      await readFile(resolve(root, "apps/store-extension/manifest.json"), "utf8"),
    );
    candidateVersion = strictVersion(manifest.version);
  } catch {
    candidateVersion = null;
  }
  if (
    minSupportedExtensionVersion !== null &&
    (candidateVersion === null ||
      compareVersions(candidateVersion, minSupportedExtensionVersion) < 0)
  ) {
    violations.push(violation("store-client-version-policy"));
  }
  const serviceWorkerSource = await readFile(
    resolve(root, "apps/store-extension/src/service-worker/service-worker.ts"),
    "utf8",
  );
  const workspaceSource = await readFile(
    resolve(root, "apps/store-extension/src/service-worker/web-workspace-handler.ts"),
    "utf8",
  );
  const sourceApi = stringConstant(serviceWorkerSource, "HUAYI_CLOUD_API_ORIGIN");
  const sourceWorkspace = stringConstant(workspaceSource, "HUAYI_WEB_WORKSPACE_URL");
  if (api === null || sourceApi !== api.origin) violations.push(violation("store-api-origin"));
  const expectedWorkspace = web === null ? null : `${web.origin}/app`;
  if (expectedWorkspace === null || sourceWorkspace !== expectedWorkspace) {
    violations.push(violation("store-web-workspace-url"));
  }
  const expectedHosts = api === null ? BASE_STORE_HOSTS : [...BASE_STORE_HOSTS, `${api.origin}/*`];
  const expectedCsp = `script-src 'self'; object-src 'self'; connect-src ${[
    ...BASE_CONNECT_SOURCES,
    ...(api === null ? [] : [api.origin]),
  ].join(" ")}`;
  if ((await auditStoreRelease(root, { expectedCsp, expectedHosts })).length > 0) {
    violations.push(violation("store-package"));
  }
  if (api !== null && expectedWorkspace !== null) {
    const bundle = await readFile(
      resolve(root, "apps/store-extension/dist/service-worker.js"),
      "utf8",
    );
    if (!bundle.includes(api.origin) || !bundle.includes(expectedWorkspace)) {
      violations.push(violation("store-bundle-origin"));
    }
  }
}

async function auditWeb(root, violations) {
  const dist = resolve(root, "apps/web/dist");
  const files = await listFiles(dist);
  const contents = await Promise.all(
    files.map(async (file) => ({ file, text: await readFile(resolve(dist, file), "utf8") })),
  );
  const index = contents.find((entry) => entry.file === "index.html")?.text ?? "";
  if (hasRemoteOrInlineCode(index)) violations.push(violation("web-remote-code"));
  if (
    contents.some((entry) => SERVER_SECRET_MARKERS.some((marker) => entry.text.includes(marker)))
  ) {
    violations.push(violation("web-server-secret"));
  }
  const bundle = contents.map((entry) => entry.text).join("\n");
  if (
    !bundle.includes("华译 Cloud V1 隐私说明") ||
    !bundle.includes("Chrome Web Store User Data Policy")
  ) {
    violations.push(violation("web-privacy-artifact"));
  }
  const vercel = JSON.parse(await readFile(resolve(root, "apps/web/vercel.json"), "utf8"));
  if (
    !Array.isArray(vercel.rewrites) ||
    !vercel.rewrites.some(
      (rewrite) => rewrite?.source === "/(.*)" && rewrite?.destination === "/index.html",
    )
  ) {
    violations.push(violation("web-privacy-artifact"));
  }
}

async function auditMaterials(root, api, web, privacy, violations) {
  const policy = await readFile(resolve(root, "docs/cloud-v1/privacy-policy.md"), "utf8");
  if (/(?:草案|预发布|待补|待确认|待核验|待公布)/u.test(policy)) {
    violations.push(violation("privacy-not-final"));
  }
  const policyFacts = [
    /Chrome Web Store User Data\s+Policy/u,
    /不是端到端加密/u,
    /BYOK/u,
    /欧路/u,
    /(?:完整账号(?:数据)?(?:导出|备份)|导出[^\n]{0,40}完整账号数据)/u,
    /24 小时内删除/u,
  ];
  if (policyFacts.some((fact) => !fact.test(policy))) {
    violations.push(violation("privacy-required-facts"));
  }
  const listing = await readFile(resolve(root, "docs/cloud-v1/store-listing.md"), "utf8");
  const publicMaterials = `${policy}\n${listing}`;
  if (PHASE_27_DISCLOSURES.some((fact) => !fact.test(publicMaterials))) {
    violations.push(violation("phase-27-disclosure-required"));
  }
  if (PHASE_27_LEGACY_IMPORT_MARKERS.some((marker) => marker.test(publicMaterials))) {
    violations.push(violation("phase-27-legacy-import"));
  }
  const manifest = JSON.parse(
    await readFile(resolve(root, "apps/store-extension/manifest.json"), "utf8"),
  );
  const required = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.host_permissions)
      ? manifest.host_permissions.map((host) => new URL(host.replace(/\/\*$/u, "")).hostname)
      : []),
    api?.origin,
    web?.origin,
    privacy?.href,
  ].filter((value) => typeof value === "string");
  if (
    required.some((value) => !listing.includes(value)) ||
    LEGACY_DISCLOSURE_MARKERS.some((marker) => listing.includes(marker))
  ) {
    violations.push(violation("disclosure-drift"));
  }
}

export async function auditCloudRelease(repositoryRoot, configuration) {
  const root = resolve(repositoryRoot);
  const violations = [];
  const { api, minSupportedExtensionVersion, privacy, web } = configurationEvidence(
    configuration,
    violations,
  );
  await auditStore(root, api, web, minSupportedExtensionVersion, violations);
  await auditWeb(root, violations);
  await auditMaterials(root, api, web, privacy, violations);
  const deduplicated = [...new Map(violations.map((item) => [item.code, item])).values()].sort(
    (left, right) => left.code.localeCompare(right.code),
  );
  return { ready: deduplicated.length === 0, violations: deduplicated };
}

export function auditCloudDevelopmentBlockers(result) {
  const expected = new Set(CLOUD_DEVELOPMENT_BLOCKER_CODES);
  const observed = new Set(result.violations.map((item) => item.code));
  const violations = [];
  if ([...expected].some((code) => !observed.has(code))) {
    violations.push(violation("development-blocker-missing"));
  }
  if ([...observed].some((code) => !expected.has(code))) {
    violations.push(violation("development-blocker-unexpected"));
  }
  return { blockedAsExpected: violations.length === 0, violations };
}

async function main() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = await auditCloudRelease(repositoryRoot, {
    apiExtensionId: process.env.HUAYI_STORE_EXTENSION_ID,
    apiOrigin: process.env.HUAYI_RELEASE_API_ORIGIN,
    extensionId: process.env.HUAYI_RELEASE_EXTENSION_ID,
    minSupportedExtensionVersion: process.env.HUAYI_MIN_SUPPORTED_EXTENSION_VERSION,
    privacyUrl: process.env.HUAYI_RELEASE_PRIVACY_URL,
    webOrigin: process.env.HUAYI_RELEASE_WEB_ORIGIN,
  });
  if (process.argv[2] === "development-blocked") {
    const baseline = auditCloudDevelopmentBlockers(result);
    for (const item of baseline.violations) {
      process.stderr.write(`[${item.code}] ${item.message}\n`);
    }
    if (!baseline.blockedAsExpected) process.exitCode = 1;
    return;
  }
  for (const item of result.violations) process.stderr.write(`[${item.code}] ${item.message}\n`);
  if (!result.ready) process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("Cloud release audit could not inspect the candidate.\n");
    process.exitCode = 1;
  });
}

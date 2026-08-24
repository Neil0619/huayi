import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  canonicalDockerHubRepoDigest,
  resolveLocalDockerInspectionTarget,
  runBoundedLocalInspection,
} from "./acceptance-local-docker-inspection.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockRelativePath = "supabase/platform-images.lock.json";
const platformLockSha256 = "b9f8e315ede181d8b7920e68fc06cd3b3d272def197c9efc1aa65743f1cfc3b7";
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const runtimePlatforms = ["linux/amd64", "linux/arm64"];
const allowedIndexMediaTypes = new Set([
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.index.v1+json",
]);
const allowedManifestMediaTypes = new Set([
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
]);

const sourceFiles = {
  "apps/cli-go/pkg/config/config.go":
    "sha256:aa8e3e46011be6cdb70f177cec63522823a9dbce1129a7bcb724e0075278421b",
  "apps/cli-go/pkg/config/templates/Dockerfile":
    "sha256:a386c05c6b4f34c9b9553668cbe3b38d19bba72528d82758ff8ea2a39572be07",
  "apps/cli-go/pkg/config/templates/config.toml":
    "sha256:4a7d44b36e91a3321c8ad71d8bdbde8472bf8630acb83bab91ca5ef3beadf6ac",
  "apps/cli/src/legacy/commands/start/start.gates.ts":
    "sha256:6746159397337600a06dc69e3f22aabc0361b2e3fe6b4d24d5476d07805aba18",
  "apps/cli/src/legacy/commands/start/start.services.ts":
    "sha256:9fd5315c34617944eaa2541e8c13860680e8001592ab03fe78ef710186c0ee20",
  "apps/cli/src/legacy/shared/legacy-local-config-values.ts":
    "sha256:d81f2f7c653f9fa93fb25e087df37df6b06edd9f24bc51ac43950cec19794dd9",
};

const serviceDefinitions = [
  ["postgres", "pg", "always", "supabase/postgres:17.6.1.159"],
  ["logflare", "logflare", "analytics.enabled", "supabase/logflare:1.50.2"],
  ["vector", "vector", "analytics.enabled", "timberio/vector:0.53.0-alpine"],
  ["kong", "kong", "not excluded", "library/kong:2.8.1"],
  ["gotrue", "gotrue", "auth.enabled", "supabase/gotrue:v2.195.0"],
  ["mailpit", "mailpit", "local_smtp.enabled", "axllent/mailpit:v1.30.2"],
  ["realtime", "realtime", "realtime.enabled", "supabase/realtime:v2.129.0"],
  ["postgrest", "postgrest", "api.enabled", "postgrest/postgrest:v16.1"],
  ["storage", "storage", "storage.enabled", "supabase/storage-api:v1.69.11"],
  [
    "imgproxy",
    "imgproxy",
    "storage.enabled && storage.image_transformation.enabled",
    "darthsim/imgproxy:v3.8.0",
  ],
  ["edge-runtime", "edgeruntime", "edge_runtime.enabled", "supabase/edge-runtime:v1.74.3"],
  ["postgres-meta", "pgmeta", "studio.enabled", "supabase/postgres-meta:v0.98.0"],
  ["studio", "studio", "studio.enabled", "supabase/studio:2026.08.17-sha-0c1da8f"],
  ["supavisor", "supavisor", "db.pooler.enabled", "supabase/supavisor:2.9.7"],
];

const relevantEnvironmentSelectors =
  "SUPABASE_ENV SUPABASE_ANALYTICS_ENABLED SUPABASE_API_ENABLED SUPABASE_AUTH_ENABLED SUPABASE_DB_MAJOR_VERSION SUPABASE_DB_POOLER_ENABLED SUPABASE_EDGE_RUNTIME_ENABLED SUPABASE_LOCAL_SMTP_ENABLED SUPABASE_REALTIME_ENABLED SUPABASE_STORAGE_ENABLED SUPABASE_STORAGE_IMAGE_TRANSFORMATION_ENABLED SUPABASE_STUDIO_ENABLED".split(
    " ",
  );

const nestedEnvironmentFiles =
  ".env.development.local .env.local .env.development .env supabase/.env.development.local supabase/.env.local supabase/.env.development supabase/.env".split(
    " ",
  );

const versionOverrideFiles =
  "postgres-version gotrue-version rest-version storage-version edge-runtime-version realtime-version studio-version pg-meta-version pooler-version logflare-version".split(
    " ",
  );

function exactKeys(value, keys) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function parseRelevantToml(document) {
  const values = new Map();
  let section = "";
  for (const line of document.split(/\r?\n/u)) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line);
    if (sectionMatch !== null) {
      section = sectionMatch[1].trim();
      continue;
    }
    const valueMatch = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*(?:#.*)?$/u.exec(line);
    if (valueMatch === null) continue;
    const key = `${section}.${valueMatch[1]}`;
    if (values.has(key)) throw new Error("Duplicate platform activation value.");
    const raw = valueMatch[2].trim();
    values.set(key, raw === "true" ? true : raw === "false" ? false : Number(raw));
  }
  return values;
}

function deriveEnabledServices(config) {
  const bool = (key, fallback) => {
    const value = config.has(key) ? config.get(key) : fallback;
    if (typeof value !== "boolean") throw new Error("Invalid platform activation value.");
    return value;
  };
  if (config.get("db.major_version") !== 17) throw new Error("PostgreSQL major drifted.");
  const analytics = bool("analytics.enabled", true);
  const storage = bool("storage.enabled", true);
  const studio = bool("studio.enabled", true);
  return new Map([
    ["postgres", true],
    ["logflare", analytics],
    ["vector", analytics],
    ["kong", true],
    ["gotrue", bool("auth.enabled", true)],
    ["mailpit", bool("local_smtp.enabled", true)],
    ["realtime", bool("realtime.enabled", true)],
    ["postgrest", bool("api.enabled", true)],
    ["storage", storage],
    ["imgproxy", storage && bool("storage.image_transformation.enabled", false)],
    ["edge-runtime", bool("edge_runtime.enabled", true)],
    ["postgres-meta", studio],
    ["studio", studio],
    ["supavisor", bool("db.pooler.enabled", false)],
  ]);
}

function validateLock(lock, enabledServices) {
  if (!exactKeys(lock, ["contract", "cliVersion", "source", "discovery", "services"])) {
    throw new Error("Invalid platform image lock.");
  }
  if (lock.contract !== "huayi-supabase-platform-images/v1" || lock.cliVersion !== "2.115.0") {
    throw new Error("Invalid platform image lock.");
  }
  if (
    !exactKeys(lock.source, ["tag", "commit", "repository", "files"]) ||
    lock.source.tag !== "v2.115.0" ||
    lock.source.commit !== "18ae43a34a2257458197b62f74e2a97e2b5cf7f9" ||
    lock.source.repository !== "https://github.com/supabase/cli" ||
    JSON.stringify(lock.source.files) !== JSON.stringify(sourceFiles)
  ) {
    throw new Error("Invalid platform image lock.");
  }
  if (
    !exactKeys(lock.discovery, [
      "registry",
      "resolvedAt",
      "runtimePlatforms",
      "exclude",
      "method",
    ]) ||
    lock.discovery.registry !== "registry-1.docker.io" ||
    !Array.isArray(lock.discovery.exclude) ||
    lock.discovery.exclude.length !== 0 ||
    JSON.stringify(lock.discovery.runtimePlatforms) !== JSON.stringify(runtimePlatforms) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(lock.discovery.resolvedAt) ||
    typeof lock.discovery.method !== "string"
  ) {
    throw new Error("Invalid platform image lock.");
  }
  if (!Array.isArray(lock.services) || lock.services.length !== serviceDefinitions.length) {
    throw new Error("Incomplete platform image lock.");
  }
  for (const [index, definition] of serviceDefinitions.entries()) {
    const [serviceName, alias, gate, sourceImage] = definition;
    const service = lock.services[index];
    const enabled = enabledServices.get(serviceName);
    if (
      service?.service !== serviceName ||
      service.alias !== alias ||
      service.gate !== gate ||
      service.enabled !== enabled ||
      typeof service.reason !== "string" ||
      service.reason.length === 0
    ) {
      throw new Error("Platform service graph drifted.");
    }
    const sourceReference = `docker.io/${sourceImage}`;
    if (!enabled) {
      if (!exactKeys(service, ["service", "alias", "gate", "enabled", "reason", "imageTag"])) {
        throw new Error("Invalid disabled platform service.");
      }
      if (service.imageTag !== sourceReference) throw new Error("Platform image tag drifted.");
      continue;
    }
    if (!exactKeys(service, ["service", "alias", "gate", "enabled", "reason", "image"])) {
      throw new Error("Invalid enabled platform service.");
    }
    const split = sourceReference.lastIndexOf(":");
    const image = service.image;
    if (
      !exactKeys(image, ["repository", "tag", "tagDigest", "indexMediaType", "platforms"]) ||
      image.repository !== sourceReference.slice(0, split) ||
      image.tag !== sourceReference.slice(split + 1) ||
      !digestPattern.test(image.tagDigest) ||
      !allowedIndexMediaTypes.has(image.indexMediaType) ||
      !exactKeys(image.platforms, runtimePlatforms)
    ) {
      throw new Error("Invalid pinned platform image.");
    }
    for (const platformName of runtimePlatforms) {
      const platform = image.platforms[platformName];
      if (
        !exactKeys(platform, ["manifestDigest", "mediaType"]) ||
        !digestPattern.test(platform.manifestDigest) ||
        !allowedManifestMediaTypes.has(platform.mediaType)
      ) {
        throw new Error("Invalid pinned platform manifest.");
      }
    }
  }
}

async function defaultFileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function readHostedSupabasePlatformImageLock({
  readText = readFile,
  root = repositoryRoot,
} = {}) {
  return JSON.parse(await readText(join(root, lockRelativePath), "utf8"));
}

export async function verifyHostedSupabasePlatformImageLock({
  environment = process.env,
  fileExists = defaultFileExists,
  readText = readFile,
  root = repositoryRoot,
} = {}) {
  if (relevantEnvironmentSelectors.some((name) => environment[name] !== undefined)) {
    throw new Error("Platform activation environment is not clean.");
  }
  if (
    await Promise.all(nestedEnvironmentFiles.map((name) => fileExists(join(root, name)))).then(
      (values) => values.some(Boolean),
    )
  ) {
    throw new Error("Platform activation environment file is present.");
  }
  const [packageDocument, configDocument, lockDocument] = await Promise.all([
    readText(join(root, "package.json"), "utf8").then(JSON.parse),
    readText(join(root, "supabase/config.toml"), "utf8"),
    readText(join(root, lockRelativePath), "utf8"),
  ]);
  if (packageDocument.devDependencies?.supabase !== "2.115.0") {
    throw new Error("Supabase CLI is not pinned.");
  }
  if (
    await Promise.all(
      versionOverrideFiles.map((name) => fileExists(join(root, "supabase/.temp", name))),
    ).then((values) => values.some(Boolean))
  ) {
    throw new Error("Supabase service image override is present.");
  }
  if (createHash("sha256").update(lockDocument).digest("hex") !== platformLockSha256) {
    throw new Error("Platform image lock content drifted.");
  }
  const lock = JSON.parse(lockDocument);
  const enabledServices = deriveEnabledServices(parseRelevantToml(configDocument));
  validateLock(lock, enabledServices);
  return {
    activeImageCount: lock.services.filter((service) => service.enabled).length,
    disabledServiceCount: lock.services.filter((service) => !service.enabled).length,
    verified: true,
  };
}

export async function inspectHostedSupabasePlatformImages({
  architecture = process.arch === "x64" ? "amd64" : process.arch,
  lock,
  resolveDockerTarget = resolveLocalDockerInspectionTarget,
  runInspection = runBoundedLocalInspection,
} = {}) {
  const platformName = `linux/${architecture}`;
  if (!runtimePlatforms.includes(platformName)) return { ready: false };
  const dockerTarget = await resolveDockerTarget();
  const active = lock.services.filter((service) => service.enabled);
  const results = await Promise.all(
    active.map(async (service) => {
      const reference = `${service.image.repository}@${service.image.tagDigest}`;
      const canonicalRepoDigest = canonicalDockerHubRepoDigest(
        service.image.repository,
        service.image.tagDigest,
      );
      const platform = service.image.platforms?.[platformName];
      if (
        canonicalRepoDigest === null ||
        platform === undefined ||
        !digestPattern.test(platform.manifestDigest)
      ) {
        return false;
      }
      const result = await runInspection(dockerTarget.command, [
        "--host",
        dockerTarget.host,
        "image",
        "inspect",
        "--format",
        "{{json .}}",
        reference,
      ]);
      if (result.code !== 0) return false;
      try {
        const inspected = JSON.parse(result.stdout);
        return (
          inspected.Os === "linux" &&
          inspected.Architecture === architecture &&
          Array.isArray(inspected.RepoDigests) &&
          inspected.RepoDigests.includes(canonicalRepoDigest)
        );
      } catch {
        return false;
      }
    }),
  );
  return { ready: results.length === 11 && results.every(Boolean) };
}

export async function runHostedSupabasePlatformLockCli({
  arguments_ = process.argv.slice(2),
  inspectImages = inspectHostedSupabasePlatformImages,
  verifyLock = verifyHostedSupabasePlatformImageLock,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (
    arguments_.length !== 1 ||
    (arguments_[0] !== "--verify-lock" && arguments_[0] !== "--verify-local-images")
  ) {
    writeError("Hosted Supabase platform image lock arguments are invalid.\n");
    return 1;
  }
  try {
    const lockResult = await verifyLock();
    if (arguments_[0] === "--verify-lock") {
      writeOutput(
        `Hosted Supabase platform image lock passed: ${lockResult.activeImageCount} active, ${lockResult.disabledServiceCount} disabled.\n`,
      );
      return 0;
    }
    if (arguments_[0] === "--verify-local-images") {
      const lock = await readHostedSupabasePlatformImageLock();
      const result = await inspectImages({ lock });
      if (!result.ready) throw new Error("images unavailable");
      writeOutput("Hosted Supabase platform local image inspection passed.\n");
      return 0;
    }
  } catch {
    writeError("Hosted Supabase platform image lock verification failed.\n");
    return 1;
  }
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedSupabasePlatformLockCli();
}

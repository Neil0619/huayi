import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  HEALTH_TIMEOUT_MS,
  NativeHostClient,
  createNativeHostSpawnOptions,
  resolveCodexHome,
  validateSmokeResult,
} from "./native-host-smoke-client.mjs";

export {
  HEALTH_TIMEOUT_MS,
  NativeHostClient,
  NativeMessageDecoder,
  createNativeHostSpawnOptions,
  encodeNativeMessage,
  resolveCodexHome,
  validateSmokeResult,
} from "./native-host-smoke-client.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function isMissingFileError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function listRelativeFiles(rootDirectory, currentDirectory = rootDirectory) {
  let entries;
  try {
    entries = await readdir(currentDirectory, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(rootDirectory, absolutePath)));
    } else {
      files.push(relative(rootDirectory, absolutePath));
    }
  }
  return files;
}

export function findNewFiles(before, after) {
  const previous = new Set(before);
  return [...after].filter((path) => !previous.has(path)).sort();
}

export function formatSmokeTimings({ firstDeltaAt, fullResultAt, startedAt }) {
  if (
    !Number.isFinite(firstDeltaAt) ||
    !Number.isFinite(fullResultAt) ||
    !Number.isFinite(startedAt) ||
    firstDeltaAt < startedAt ||
    fullResultAt < firstDeltaAt
  ) {
    throw new Error("Smoke analysis did not provide valid streaming timings.");
  }
  return (
    `  first delta: ${Math.round(firstDeltaAt - startedAt)} ms; ` +
    `full result: ${Math.round(fullResultAt - startedAt)} ms\n`
  );
}

async function canonicalExecutable(path) {
  await access(path);
  return realpath(path);
}

export async function resolveExecutable(explicitPath, pathEnvironment = "") {
  if (explicitPath !== undefined) {
    if (!isAbsolute(explicitPath)) {
      throw new Error("HUAYI_CODEX_PATH must be absolute.");
    }
    return canonicalExecutable(explicitPath);
  }
  for (const directory of pathEnvironment.split(delimiter)) {
    if (!isAbsolute(directory)) {
      continue;
    }
    try {
      return await canonicalExecutable(join(directory, "codex"));
    } catch {
      // Continue without a shell so no command string can be injected through PATH.
    }
  }
  throw new Error("Codex CLI was not found in PATH.");
}

export function createSmokeRequests(schemaVersion) {
  return [
    {
      action: "translate",
      context: "He said the investigation was in its early stages.",
      requestId: "smoke-investigation",
      schemaVersion,
      selection: "investigation",
      selectionKind: "word",
      sentenceContext: null,
      targetLanguage: "zh-CN",
      type: "analyze",
    },
    {
      action: "explain",
      context: "The region experienced a sustained heatwave throughout July.",
      requestId: "smoke-sustained-heatwave",
      schemaVersion,
      selection: "sustained heatwave",
      selectionKind: "phrase",
      sentenceContext: null,
      targetLanguage: "zh-CN",
      type: "analyze",
    },
    {
      action: "explain",
      context:
        "He said the investigation was in the early stages and urged anyone with information to come forward.",
      requestId: "smoke-sentence",
      schemaVersion,
      selection:
        "He said the investigation was in the early stages and urged anyone with information to come forward.",
      selectionKind: "sentence",
      sentenceContext: null,
      targetLanguage: "zh-CN",
      type: "analyze",
    },
    {
      action: "translate",
      context:
        "The investigation remains in its early stages.\nOfficials asked witnesses to come forward with information.",
      requestId: "smoke-paragraph",
      schemaVersion,
      selection:
        "The investigation remains in its early stages.\nOfficials asked witnesses to come forward with information.",
      selectionKind: "paragraph",
      sentenceContext: null,
      targetLanguage: "zh-CN",
      type: "analyze",
    },
  ];
}

export async function closeHostAndSnapshotSessions({
  client,
  removeWorkingDirectory,
  snapshotSessions,
}) {
  let closeError;
  try {
    await client.close();
  } catch (error) {
    if (!client.shutdownComplete) {
      throw error;
    }
    closeError = error;
  } finally {
    await removeWorkingDirectory();
  }

  return {
    afterSessions: await snapshotSessions(),
    closeError,
  };
}

async function runSmoke() {
  const hostBundle = resolve(repositoryRoot, "apps/native-host/dist/main.js");
  const schemaDirectory = resolve(repositoryRoot, "apps/native-host/dist/provider/schemas");
  const protocolEntry = resolve(repositoryRoot, "packages/protocol/dist/index.js");
  await Promise.all([access(hostBundle), access(schemaDirectory), access(protocolEntry)]).catch(
    (error) => {
      throw new Error("Smoke build artifacts are missing; run `pnpm build` first.", {
        cause: error,
      });
    },
  );
  const protocol = await import(pathToFileURL(protocolEntry).href);
  const codexExecutable = await resolveExecutable(process.env.HUAYI_CODEX_PATH, process.env.PATH);
  const codexHome = resolveCodexHome(process.env.CODEX_HOME);
  const sessionDirectory = join(codexHome, "sessions");
  const beforeSessions = await listRelativeFiles(sessionDirectory);
  const workingDirectory = await mkdtemp(join(tmpdir(), "huayi-smoke-"));
  const spawnOptions = createNativeHostSpawnOptions({
    codexExecutable,
    codexHome,
    environment: process.env,
    platform: process.platform,
    schemaDirectory,
    workingDirectory,
  });
  const child = spawn(process.execPath, [hostBundle], spawnOptions);
  const client = new NativeHostClient(child, protocol.hostEventSchema, {
    detachedProcessGroup: spawnOptions.detached,
  });
  let requestError;
  let shutdownOutcome;

  try {
    process.stdout.write("Checking Codex capability and ChatGPT login...\n");
    const healthRequest = protocol.healthRequestSchema.parse({
      requestId: "smoke-health",
      schemaVersion: protocol.SCHEMA_VERSION,
      type: "health",
    });
    await client.request(healthRequest, "health-result", HEALTH_TIMEOUT_MS);

    const requests = createSmokeRequests(protocol.SCHEMA_VERSION);
    for (const [index, rawRequest] of requests.entries()) {
      const request = protocol.analyzeRequestSchema.parse(rawRequest);
      process.stdout.write(
        `[${index + 1}/${requests.length}] ${request.selectionKind} ${request.action}...\n`,
      );
      const startedAt = Date.now();
      const event = await client.request(request, "result", 70_000);
      const result = protocol.analysisResultSchema.parse(event.result);
      validateSmokeResult(request, result);
      process.stdout.write(
        formatSmokeTimings({
          firstDeltaAt: event.firstDeltaAt,
          fullResultAt: event.fullResultAt,
          startedAt,
        }),
      );
    }
  } catch (error) {
    requestError = error;
  } finally {
    shutdownOutcome = await closeHostAndSnapshotSessions({
      client,
      removeWorkingDirectory: () => rm(workingDirectory, { force: true, recursive: true }),
      snapshotSessions: () => listRelativeFiles(sessionDirectory),
    });
  }

  const newSessionFiles = findNewFiles(beforeSessions, shutdownOutcome.afterSessions);
  if (newSessionFiles.length > 0) {
    throw new Error(
      `Ephemeral verification failed: ${newSessionFiles.length} new Codex session file(s) appeared.`,
      { cause: shutdownOutcome.closeError ?? requestError },
    );
  }
  if (shutdownOutcome.closeError !== undefined) {
    throw shutdownOutcome.closeError;
  }
  if (requestError !== undefined) {
    throw requestError;
  }
  process.stdout.write(
    "Smoke passed: 4 results validated and no new Codex session file appeared.\n",
  );
}

function isDirectExecution() {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url;
}

if (isDirectExecution()) {
  void runSmoke().catch((error) => {
    process.stderr.write(
      `Codex smoke failed: ${error instanceof Error ? error.message : "Unknown error."}\n`,
    );
    process.exitCode = 1;
  });
}

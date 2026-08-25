import { spawn } from "node:child_process";
import { lstat, mkdir, open, readFile, readdir, rename, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  hostedImportantBatchBackupArtifactDirectory,
  hostedImportantBatchId,
  verifyHostedImportantBatchEvidencePhase,
} from "./acceptance-hosted-important-batch-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commitPattern = /^[0-9a-f]{40}$/u;
const realEvidenceIo = Object.freeze({ lstat, readFile, readdir });

export const hostedImportantBatchRebuildRetirementHistoryDirectory =
  "artifacts/hosted-important-batch-backup-history";
export const hostedImportantBatchRebuildRetirementArgument = `--confirm-retire-stale-rebuild-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;

function runGitProcess(arguments_, root) {
  return new Promise((resolveResult) => {
    let stdout = "";
    let overflow = false;
    const child = spawn("git", arguments_, {
      cwd: root,
      env: {
        GIT_OPTIONAL_LOCKS: "0",
        LANG: "C",
        LC_ALL: "C",
        PATH: process.env.PATH ?? "",
      },
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > 16_384) {
        overflow = true;
        stdout = "";
        child.kill("SIGKILL");
      } else if (!overflow) {
        stdout += chunk;
      }
    });
    child.once("error", () => resolveResult({ code: null, stdout: "" }));
    child.once("close", (code, signal) => {
      resolveResult({
        code: overflow || signal !== null ? null : code,
        stdout: overflow ? "" : stdout,
      });
    });
  });
}

export async function readHostedImportantBatchRebuildRetirementRepositoryState(
  root,
  { runGit = (arguments_) => runGitProcess(arguments_, root) } = {},
) {
  const [head, upstream, status, activeIgnored, historyIgnored] = await Promise.all([
    runGit(["rev-parse", "--verify", "HEAD"]),
    runGit(["rev-parse", "--verify", "@{upstream}"]),
    runGit(["status", "--porcelain=v1", "--untracked-files=normal"]),
    runGit(["check-ignore", "--quiet", "--", hostedImportantBatchBackupArtifactDirectory]),
    runGit([
      "check-ignore",
      "--quiet",
      "--",
      hostedImportantBatchRebuildRetirementHistoryDirectory,
    ]),
  ]);
  const candidateCommit = head.code === 0 ? head.stdout.trim() : "";
  const upstreamCommit = upstream.code === 0 ? upstream.stdout.trim() : "";
  return {
    artifactRootIgnored: activeIgnored.code === 0 && activeIgnored.stdout === "",
    candidateCommit,
    historyRootIgnored: historyIgnored.code === 0 && historyIgnored.stdout === "",
    upstreamExact: commitPattern.test(upstreamCommit) && upstreamCommit === candidateCommit,
    worktreeClean: status.code === 0 && status.stdout === "",
  };
}

function assertRepositoryState(state) {
  if (
    state === null ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    !commitPattern.test(state.candidateCommit) ||
    state.artifactRootIgnored !== true ||
    state.historyRootIgnored !== true ||
    state.upstreamExact !== true ||
    state.worktreeClean !== true
  ) {
    throw new Error("Hosted important-batch stale rebuild retirement is unsafe.");
  }
}

async function pathExists(evidenceIo, path) {
  try {
    await evidenceIo.lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertPrivateDirectory(evidenceIo, path) {
  const stats = await evidenceIo.lstat(path);
  if (!stats.isDirectory() || (stats.mode & 0o777) !== 0o700) {
    throw new Error("Hosted important-batch stale rebuild retirement is unsafe.");
  }
}

async function ensurePrivateDirectory(evidenceIo, path) {
  let created = false;
  try {
    await mkdir(path, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await assertPrivateDirectory(evidenceIo, path);
  return created;
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function assertActiveBatchEntries(entries) {
  const allowed = new Set(["post", "pre", "rebuild"]);
  if (
    new Set(entries).size !== entries.length ||
    !entries.includes("rebuild") ||
    entries.some((entry) => !allowed.has(entry))
  ) {
    throw new Error("Hosted important-batch stale rebuild retirement is unsafe.");
  }
}

function assertRetiredActiveBatchEntries(entries) {
  const allowed = new Set(["post", "pre"]);
  if (new Set(entries).size !== entries.length || entries.some((entry) => !allowed.has(entry))) {
    throw new Error("Hosted important-batch stale rebuild retirement is unsafe.");
  }
}

export async function retireHostedImportantBatchRebuild({
  directorySync = syncDirectory,
  evidenceIo = realEvidenceIo,
  readRepositoryState = readHostedImportantBatchRebuildRetirementRepositoryState,
  renameLeaf = rename,
  repositoryRoot: root = repositoryRoot,
} = {}) {
  const state = await readRepositoryState(root);
  assertRepositoryState(state);

  const activeBatch = join(root, hostedImportantBatchBackupArtifactDirectory);
  const activeSecureRoot = dirname(activeBatch);
  await assertPrivateDirectory(evidenceIo, activeSecureRoot);
  await assertPrivateDirectory(evidenceIo, activeBatch);
  assertActiveBatchEntries(await evidenceIo.readdir(activeBatch));

  const manifest = await verifyHostedImportantBatchEvidencePhase({
    batchRoot: activeBatch,
    evidenceIo,
    phase: "rebuild",
  });
  if (manifest.candidateCommit === state.candidateCommit) {
    throw new Error("Hosted important-batch stale rebuild retirement is unsafe.");
  }

  const historyRoot = join(root, hostedImportantBatchRebuildRetirementHistoryDirectory);
  const historyBatch = join(historyRoot, hostedImportantBatchId);
  const candidateRoot = join(historyBatch, manifest.candidateCommit);
  const destination = join(candidateRoot, "rebuild");
  const activeRebuild = join(activeBatch, "rebuild");
  if (await pathExists(evidenceIo, candidateRoot)) {
    throw new Error("Hosted important-batch stale rebuild retirement is unsafe.");
  }

  if (await ensurePrivateDirectory(evidenceIo, historyRoot)) {
    await directorySync(dirname(historyRoot));
  }
  if (await ensurePrivateDirectory(evidenceIo, historyBatch)) {
    await directorySync(historyRoot);
  }
  await mkdir(candidateRoot, { mode: 0o700 });
  await assertPrivateDirectory(evidenceIo, candidateRoot);

  let moved = false;
  try {
    await directorySync(historyBatch);
    await renameLeaf(activeRebuild, destination);
    moved = true;
    await directorySync(activeBatch);
    await directorySync(candidateRoot);
    await directorySync(historyBatch);
    assertRetiredActiveBatchEntries(await evidenceIo.readdir(activeBatch));
    const retainedManifest = await verifyHostedImportantBatchEvidencePhase({
      batchRoot: candidateRoot,
      evidenceIo,
      phase: "rebuild",
    });
    if (retainedManifest.candidateCommit !== manifest.candidateCommit) {
      throw new Error("Hosted important-batch stale rebuild retirement is unsafe.");
    }
  } catch (error) {
    if (!moved) {
      try {
        await rmdir(candidateRoot);
        await directorySync(historyBatch);
      } catch {
        // The active evidence remains authoritative; an empty reservation is safe to inspect later.
      }
    }
    throw error;
  }
}

export async function runHostedImportantBatchRebuildRetirementCli({
  arguments_ = process.argv.slice(2),
  retireEvidence = retireHostedImportantBatchRebuild,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedImportantBatchRebuildRetirementArgument
    ) {
      throw new Error("Hosted important-batch stale rebuild retirement arguments are invalid.");
    }
    await retireEvidence();
    writeOutput("Hosted important-batch stale rebuild evidence retired.\n");
    return 0;
  } catch {
    writeError("Hosted important-batch stale rebuild evidence retirement failed closed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedImportantBatchRebuildRetirementCli();
}

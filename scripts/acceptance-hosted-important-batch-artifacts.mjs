import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  hostedImportantBatchBackupArtifactDirectory,
  hostedImportantBatchId,
} from "./acceptance-hosted-important-batch-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const commitPattern = /^[0-9a-f]{40}$/u;
const phaseMigrationHeads = Object.freeze({
  post: "20260824010000",
  pre: "20260823010000",
});
const rebuildVerdictKeys = Object.freeze([
  "fictionalSeedExact",
  "hostedDataAbsent",
  "migrationChainExact",
  "runtimeContractExact",
  "scratchDestroyed",
]);

function defaultPrivateModeMatches(stats, expectedMode) {
  return (stats.mode & 0o777) === expectedMode;
}

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolveHash(hash.digest("hex")));
  });
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function ensureDirectory(path, { privateModeMatches, secure }) {
  try {
    await mkdir(path, { mode: secure ? 0o700 : 0o755 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const stats = await lstat(path);
  if (!stats.isDirectory() || (secure && !privateModeMatches(stats, 0o700))) {
    throw new Error("Hosted important-batch artifact directory is unsafe.");
  }
}

async function ensureArtifactDirectory(repositoryRoot, leaf, privateModeMatches) {
  const artifactsRoot = join(repositoryRoot, "artifacts");
  const secureRoot = join(repositoryRoot, "artifacts", "hosted-important-batch-backups");
  const batchRoot = join(repositoryRoot, hostedImportantBatchBackupArtifactDirectory);
  const leafRoot = join(batchRoot, leaf);
  await ensureDirectory(artifactsRoot, { privateModeMatches, secure: false });
  await ensureDirectory(secureRoot, { privateModeMatches, secure: true });
  await ensureDirectory(batchRoot, { privateModeMatches, secure: true });
  await ensureDirectory(leafRoot, { privateModeMatches, secure: true });
  return leafRoot;
}

async function assertDirectoryEmpty(path) {
  if ((await readdir(path)).length !== 0) {
    throw new Error("Hosted important-batch evidence directory is not empty.");
  }
}

async function createEmptyPrivateFile(path) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncPrivateFile(path, { privateModeMatches, requireContent }) {
  const handle = await open(path, "r+");
  try {
    await handle.chmod(0o600);
    await handle.sync();
    const stats = await handle.stat();
    if (
      !stats.isFile() ||
      !privateModeMatches(stats, 0o600) ||
      !Number.isSafeInteger(stats.size) ||
      stats.size < (requireContent ? 1 : 0)
    ) {
      throw new Error("Hosted important-batch artifact file is unsafe.");
    }
    return stats;
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeCanonicalJsonAtomically({ document, directory, finalPath, partialPath }) {
  const handle = await open(partialPath, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(document)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(partialPath, finalPath);
  await syncDirectory(directory);
}

function assertCandidateCommit(candidateCommit) {
  if (!commitPattern.test(candidateCommit)) {
    throw new Error("Hosted important-batch candidate commit is invalid.");
  }
}

function isoTimestamp(now) {
  const value = now().toISOString();
  if (new Date(value).toISOString() !== value) {
    throw new Error("Hosted important-batch timestamp is invalid.");
  }
  return value;
}

export async function persistHostedImportantBatchBackup({
  candidateCommit,
  now = () => new Date(),
  phase,
  privateModeMatches = defaultPrivateModeMatches,
  produceArchive,
  repositoryRoot,
  verifyArchive,
}) {
  assertCandidateCommit(candidateCommit);
  if (!Object.hasOwn(phaseMigrationHeads, phase)) {
    throw new Error("Hosted important-batch backup phase is invalid.");
  }
  const phaseRoot = await ensureArtifactDirectory(repositoryRoot, phase, privateModeMatches);
  await assertDirectoryEmpty(phaseRoot);
  const archivePath = join(phaseRoot, "database.dump");
  const archivePartialPath = join(phaseRoot, "database.dump.partial");
  const manifestPath = join(phaseRoot, "backup-manifest.json");
  const manifestPartialPath = join(phaseRoot, "backup-manifest.json.partial");
  if (
    await Promise.all(
      [archivePath, archivePartialPath, manifestPath, manifestPartialPath].map(pathExists),
    ).then((values) => values.some(Boolean))
  ) {
    throw new Error("Hosted important-batch backup evidence already exists.");
  }

  let archiveCommitted = false;
  let manifestCommitted = false;
  try {
    await createEmptyPrivateFile(archivePartialPath);
    await produceArchive({ archivePartialPath, phaseRoot });
    const beforeVerification = await syncPrivateFile(archivePartialPath, {
      privateModeMatches,
      requireContent: true,
    });
    const beforeVerificationSha256 = await hashFile(archivePartialPath);
    await verifyArchive({ archivePartialPath });
    const afterVerification = await syncPrivateFile(archivePartialPath, {
      privateModeMatches,
      requireContent: true,
    });
    const archiveSha256 = await hashFile(archivePartialPath);
    if (
      beforeVerification.size !== afterVerification.size ||
      beforeVerificationSha256 !== archiveSha256
    ) {
      throw new Error("Hosted important-batch archive changed during verification.");
    }
    await rename(archivePartialPath, archivePath);
    archiveCommitted = true;
    await syncDirectory(phaseRoot);
    await writeCanonicalJsonAtomically({
      directory: phaseRoot,
      document: {
        batchId: hostedImportantBatchId,
        candidateCommit,
        capturedAt: isoTimestamp(now),
        connectionProfile: "verify-full-administrator",
        contract: "huayi-hosted-important-batch-logical-backup/v1",
        dumpBytes: afterVerification.size,
        dumpFile: "database.dump",
        dumpFormat: "postgres-custom",
        dumpSha256: archiveSha256,
        migrationHead: phaseMigrationHeads[phase],
        phase,
        projectRef: hostedAcceptanceProjectRef,
      },
      finalPath: manifestPath,
      partialPath: manifestPartialPath,
    });
    manifestCommitted = true;
  } finally {
    await Promise.all([
      rm(archivePartialPath, { force: true }),
      rm(manifestPartialPath, { force: true }),
    ]);
    if (!manifestCommitted) {
      if (archiveCommitted) await rm(archivePath, { force: true });
      await rm(manifestPath, { force: true });
    }
  }
}

export async function persistHostedImportantBatchRebuild({
  candidateCommit,
  now = () => new Date(),
  performRebuild,
  privateModeMatches = defaultPrivateModeMatches,
  repositoryRoot,
}) {
  assertCandidateCommit(candidateCommit);
  const rebuildRoot = await ensureArtifactDirectory(repositoryRoot, "rebuild", privateModeMatches);
  await assertDirectoryEmpty(rebuildRoot);
  const manifestPath = join(rebuildRoot, "rebuild-verification.json");
  const partialPath = join(rebuildRoot, "rebuild-verification.json.partial");
  if ((await pathExists(manifestPath)) || (await pathExists(partialPath))) {
    throw new Error("Hosted important-batch rebuild evidence already exists.");
  }
  let committed = false;
  try {
    const verdict = await performRebuild();
    if (
      verdict === null ||
      typeof verdict !== "object" ||
      Object.keys(verdict).length !== rebuildVerdictKeys.length ||
      rebuildVerdictKeys.some((key) => verdict[key] !== true)
    ) {
      throw new Error("Hosted important-batch rebuild verdict is invalid.");
    }
    await writeCanonicalJsonAtomically({
      directory: rebuildRoot,
      document: {
        batchId: hostedImportantBatchId,
        candidateCommit,
        completedAt: isoTimestamp(now),
        contract: "huayi-hosted-important-batch-rebuild-verification/v1",
        fictionalSeedExact: true,
        hostedDataAbsent: true,
        migrationChainExact: true,
        migrationHead: "20260824010000",
        projectRef: hostedAcceptanceProjectRef,
        rebuildSource: "repository-migrations-and-fictional-seed",
        runtimeContractExact: true,
        scratchDestroyed: true,
      },
      finalPath: manifestPath,
      partialPath,
    });
    committed = true;
  } finally {
    await rm(partialPath, { force: true });
    if (!committed) await rm(manifestPath, { force: true });
  }
}

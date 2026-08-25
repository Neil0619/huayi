import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const secureArtifactRoot = "artifacts/hosted-important-batch-backups";
const phaseMigrationHeads = Object.freeze({
  post: "20260825010000",
  pre: "20260824010000",
});
const backupManifestKeys = Object.freeze([
  "batchId",
  "candidateCommit",
  "capturedAt",
  "connectionProfile",
  "contract",
  "dumpBytes",
  "dumpFile",
  "dumpFormat",
  "dumpSha256",
  "migrationHead",
  "phase",
  "projectRef",
]);
const rebuildManifestKeys = Object.freeze([
  "batchId",
  "candidateCommit",
  "completedAt",
  "contract",
  "fictionalSeedExact",
  "hostedDataAbsent",
  "migrationChainExact",
  "migrationHead",
  "projectRef",
  "rebuildSource",
  "runtimeContractExact",
  "scratchDestroyed",
]);

export const hostedPhase91BackupId = "phase-91-0015-public-function-acl-hardening";
export const hostedPhase91BackupArtifactDirectory = `${secureArtifactRoot}/${hostedPhase91BackupId}`;
export const hostedPhase91BackupPreflightArgument = `--verify-pre-0015-public-function-acl-hardening-backup-${hostedAcceptanceProjectRef}`;
export const hostedPhase91BackupCompletionArgument = `--verify-post-0015-public-function-acl-hardening-backup-${hostedAcceptanceProjectRef}`;

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolveHash(hash.digest("hex")));
  });
}

const realEvidenceIo = Object.freeze({ hashFile, lstat, readFile, readdir });

function runGit(arguments_, cwd, { captureOutput = false } = {}) {
  return new Promise((resolveResult) => {
    let stdout = "";
    const child = spawn("git", arguments_, {
      cwd,
      env: {
        GIT_OPTIONAL_LOCKS: "0",
        LANG: process.env.LANG ?? "C",
        LC_ALL: process.env.LC_ALL ?? "C",
        PATH: process.env.PATH ?? "",
      },
      shell: false,
      stdio: ["ignore", captureOutput ? "pipe" : "ignore", "ignore"],
      windowsHide: true,
    });
    if (captureOutput) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (stdout.length < 128) stdout += chunk;
      });
    }
    child.once("error", () => resolveResult({ code: null, stdout: "" }));
    child.once("exit", (code, signal) =>
      resolveResult({ code: signal === null ? code : null, stdout }),
    );
  });
}

export async function readHostedPhase91BackupRepositoryState(root) {
  const [head, ignored, status] = await Promise.all([
    runGit(["rev-parse", "--verify", "HEAD"], root, { captureOutput: true }),
    runGit(["check-ignore", "--quiet", "--", hostedPhase91BackupArtifactDirectory], root),
    runGit(["status", "--porcelain=v1", "--untracked-files=normal"], root, {
      captureOutput: true,
    }),
  ]);
  const candidateCommit = head.code === 0 ? head.stdout.trim() : "";
  if (!/^[0-9a-f]{40}$/u.test(candidateCommit)) {
    throw new Error("Hosted Phase 91 repository state is invalid.");
  }
  return {
    artifactRootIgnored: ignored.code === 0,
    candidateCommit,
    worktreeClean: status.code === 0 && status.stdout.length === 0,
  };
}

function invalidEvidence() {
  throw new Error("Hosted Phase 91 evidence is invalid.");
}

function assertExactKeys(document, expectedKeys) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    invalidEvidence();
  }
  const actualKeys = Object.keys(document).sort();
  const expected = [...expectedKeys].sort();
  if (
    actualKeys.length !== expected.length ||
    actualKeys.some((value, index) => value !== expected[index])
  ) {
    invalidEvidence();
  }
}

function assertExactEntries(actual, expected) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((value, index) => value !== sortedExpected[index])
  ) {
    invalidEvidence();
  }
}

function assertIsoTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    new Date(value).toISOString() !== value
  ) {
    invalidEvidence();
  }
}

async function assertSecureDirectory(evidenceIo, path) {
  const stats = await evidenceIo.lstat(path);
  if (!stats.isDirectory() || (stats.mode & 0o777) !== 0o700) invalidEvidence();
}

async function assertSecureFile(evidenceIo, path, { maximumBytes }) {
  const stats = await evidenceIo.lstat(path);
  if (
    !stats.isFile() ||
    (stats.mode & 0o777) !== 0o600 ||
    !Number.isSafeInteger(stats.size) ||
    stats.size < 1 ||
    stats.size > maximumBytes
  ) {
    invalidEvidence();
  }
  return stats;
}

async function readCanonicalJson(evidenceIo, path) {
  await assertSecureFile(evidenceIo, path, { maximumBytes: 4_096 });
  const source = await evidenceIo.readFile(path, "utf8");
  if (typeof source !== "string" || Buffer.byteLength(source) > 4_096) invalidEvidence();
  try {
    const document = JSON.parse(source);
    if (source !== `${JSON.stringify(document)}\n`) invalidEvidence();
    return document;
  } catch {
    invalidEvidence();
  }
}

function assertCommonManifest(document, candidateCommit) {
  if (
    document.projectRef !== hostedAcceptanceProjectRef ||
    document.batchId !== hostedPhase91BackupId ||
    !/^[0-9a-f]{40}$/u.test(document.candidateCommit) ||
    (candidateCommit !== undefined && document.candidateCommit !== candidateCommit)
  ) {
    invalidEvidence();
  }
}

async function verifyBackupEvidence({ batchRoot, evidenceIo, phase, repositoryState }) {
  const phaseRoot = join(batchRoot, phase);
  await assertSecureDirectory(evidenceIo, phaseRoot);
  assertExactEntries(await evidenceIo.readdir(phaseRoot), [
    "backup-manifest.json",
    "database.dump",
  ]);
  const dumpPath = join(phaseRoot, "database.dump");
  const before = await assertSecureFile(evidenceIo, dumpPath, {
    maximumBytes: Number.MAX_SAFE_INTEGER,
  });
  const manifest = await readCanonicalJson(evidenceIo, join(phaseRoot, "backup-manifest.json"));
  assertExactKeys(manifest, backupManifestKeys);
  assertCommonManifest(manifest, repositoryState?.candidateCommit);
  assertIsoTimestamp(manifest.capturedAt);
  const dumpSha256 = await evidenceIo.hashFile(dumpPath);
  const after = await assertSecureFile(evidenceIo, dumpPath, {
    maximumBytes: Number.MAX_SAFE_INTEGER,
  });
  if (
    manifest.contract !== "huayi-hosted-important-batch-logical-backup/v1" ||
    manifest.phase !== phase ||
    manifest.connectionProfile !== "verify-full-administrator" ||
    manifest.dumpFormat !== "postgres-custom" ||
    manifest.dumpFile !== "database.dump" ||
    manifest.migrationHead !== phaseMigrationHeads[phase] ||
    manifest.dumpBytes !== before.size ||
    after.size !== before.size ||
    !/^[0-9a-f]{64}$/u.test(manifest.dumpSha256) ||
    dumpSha256 !== manifest.dumpSha256
  ) {
    invalidEvidence();
  }
  return manifest;
}

async function verifyRebuildEvidence({ batchRoot, evidenceIo, repositoryState }) {
  const rebuildRoot = join(batchRoot, "rebuild");
  await assertSecureDirectory(evidenceIo, rebuildRoot);
  assertExactEntries(await evidenceIo.readdir(rebuildRoot), ["rebuild-verification.json"]);
  const manifest = await readCanonicalJson(
    evidenceIo,
    join(rebuildRoot, "rebuild-verification.json"),
  );
  assertExactKeys(manifest, rebuildManifestKeys);
  assertCommonManifest(manifest, repositoryState?.candidateCommit);
  assertIsoTimestamp(manifest.completedAt);
  if (
    manifest.contract !== "huayi-hosted-important-batch-rebuild-verification/v1" ||
    manifest.migrationHead !== "20260825010000" ||
    manifest.rebuildSource !== "repository-migrations-and-fictional-seed" ||
    manifest.fictionalSeedExact !== true ||
    manifest.hostedDataAbsent !== true ||
    manifest.migrationChainExact !== true ||
    manifest.runtimeContractExact !== true ||
    manifest.scratchDestroyed !== true
  ) {
    invalidEvidence();
  }
  return manifest;
}

export async function verifyHostedPhase91EvidencePhase({ batchRoot, evidenceIo, phase }) {
  if (!new Set(["post", "pre", "rebuild"]).has(phase)) invalidEvidence();
  return phase === "rebuild"
    ? verifyRebuildEvidence({ batchRoot, evidenceIo })
    : verifyBackupEvidence({ batchRoot, evidenceIo, phase });
}

async function verifyEvidence({ evidenceIo, mode, readState, root }) {
  const state = await readState(root);
  if (
    state.artifactRootIgnored !== true ||
    !/^[0-9a-f]{40}$/u.test(state.candidateCommit) ||
    state.worktreeClean !== true
  ) {
    invalidEvidence();
  }
  const artifactRoot = join(root, secureArtifactRoot);
  const batchRoot = join(root, hostedPhase91BackupArtifactDirectory);
  await assertSecureDirectory(evidenceIo, artifactRoot);
  await assertSecureDirectory(evidenceIo, batchRoot);
  const entries = await evidenceIo.readdir(batchRoot);
  if (mode === "preflight") {
    if (
      !entries.includes("pre") ||
      !entries.includes("rebuild") ||
      entries.some((entry) => !new Set(["pre", "post", "rebuild"]).has(entry))
    ) {
      invalidEvidence();
    }
  } else {
    assertExactEntries(entries, ["post", "pre", "rebuild"]);
  }
  await verifyBackupEvidence({ batchRoot, evidenceIo, phase: "pre", repositoryState: state });
  await verifyRebuildEvidence({ batchRoot, evidenceIo, repositoryState: state });
  if (mode === "completion" || entries.includes("post")) {
    await verifyBackupEvidence({ batchRoot, evidenceIo, phase: "post", repositoryState: state });
  }
}

export function renderHostedPhase91BackupPlan() {
  return `Hosted Phase 91 backup/rebuild plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedPhase91BackupId}.
Evidence directory: ${hostedPhase91BackupArtifactDirectory}
- Phase 81 phase-81-0014 evidence stays immutable and is never read as Phase 91 evidence.
- The independent pre backup requires migration head 20260824010000.
- The isolated rebuild and post backup require migration head 20260825010000.
- Preflight requires clean exact-candidate pre and rebuild evidence; completion additionally requires post.
- This plan performs no filesystem, Git, database, mail, model, deployment, or secret operation.
`;
}

export async function runHostedPhase91BackupCli({
  arguments_ = process.argv.slice(2),
  evidenceIo = realEvidenceIo,
  readRepositoryState = readHostedPhase91BackupRepositoryState,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedPhase91BackupPlan());
    return 0;
  }
  const mode =
    arguments_.length === 1 && arguments_[0] === hostedPhase91BackupPreflightArgument
      ? "preflight"
      : arguments_.length === 1 && arguments_[0] === hostedPhase91BackupCompletionArgument
        ? "completion"
        : null;
  if (mode === null) {
    writeError("Hosted Phase 91 backup arguments are invalid.\n");
    return 1;
  }
  try {
    await verifyEvidence({ evidenceIo, mode, readState: readRepositoryState, root });
    writeOutput(
      mode === "preflight"
        ? "Hosted Phase 91 backup preflight evidence passed.\n"
        : "Hosted Phase 91 backup completion evidence passed.\n",
    );
    return 0;
  } catch {
    writeError("Hosted Phase 91 backup evidence verification failed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedPhase91BackupCli();
}

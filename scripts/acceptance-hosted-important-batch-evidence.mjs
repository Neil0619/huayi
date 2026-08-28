import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { assertHostedImportantBatchArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const secureArtifactRoot = "artifacts/hosted-important-batch-backups";
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

function invalidEvidence() {
  throw new Error("Hosted important-batch evidence is invalid.");
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

export const realHostedImportantBatchEvidenceIo = Object.freeze({
  hashFile,
  lstat,
  readFile,
  readdir,
});

function runGit(arguments_, cwd, { captureOutput = false } = {}) {
  return new Promise((resolveResult) => {
    let stdout = "";
    let overflow = false;
    const child = spawn("git", arguments_, {
      cwd,
      env: {
        GIT_OPTIONAL_LOCKS: "0",
        LANG: "C",
        LC_ALL: "C",
        PATH: process.env.PATH ?? "",
      },
      shell: false,
      stdio: ["ignore", captureOutput ? "pipe" : "ignore", "ignore"],
      windowsHide: true,
    });
    if (captureOutput) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > 256) {
          overflow = true;
          stdout = "";
          child.kill("SIGKILL");
        } else if (!overflow) {
          stdout += chunk;
        }
      });
    }
    child.once("error", () => resolveResult({ code: null, stdout: "" }));
    child.once("close", (code, signal) => {
      resolveResult({
        code: overflow || signal !== null ? null : code,
        stdout: overflow ? "" : stdout,
      });
    });
  });
}

export async function readHostedImportantBatchEvidenceRepositoryState(root, artifactDirectory) {
  const [head, upstream, ignored, status] = await Promise.all([
    runGit(["rev-parse", "--verify", "HEAD"], root, { captureOutput: true }),
    runGit(["rev-parse", "--verify", "@{upstream}"], root, { captureOutput: true }),
    runGit(["check-ignore", "--quiet", "--", artifactDirectory], root),
    runGit(["status", "--porcelain=v1", "--untracked-files=normal"], root, {
      captureOutput: true,
    }),
  ]);
  const candidateCommit = head.code === 0 ? head.stdout.trim() : "";
  const upstreamCommit = upstream.code === 0 ? upstream.stdout.trim() : "";
  if (!/^[0-9a-f]{40}$/u.test(candidateCommit)) invalidEvidence();
  return {
    artifactRootIgnored: ignored.code === 0,
    candidateCommit,
    upstreamExact: upstreamCommit === candidateCommit,
    worktreeClean: status.code === 0 && status.stdout === "",
  };
}

function assertExactKeys(document, expectedKeys) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    invalidEvidence();
  }
  const actual = Object.keys(document).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalidEvidence();
  }
}

function assertExactEntries(actual, expected) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((entry, index) => entry !== sortedExpected[index])
  ) {
    invalidEvidence();
  }
}

async function assertSecureDirectory(evidenceIo, path) {
  const stats = await evidenceIo.lstat(path);
  if (!stats.isDirectory() || (stats.mode & 0o777) !== 0o700) invalidEvidence();
}

async function assertSecureFile(evidenceIo, path, maximumBytes) {
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
  await assertSecureFile(evidenceIo, path, 4_096);
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

function assertCommonManifest(document, artifactContract) {
  if (
    document.projectRef !== hostedAcceptanceProjectRef ||
    document.batchId !== artifactContract.batchId ||
    !/^[0-9a-f]{40}$/u.test(document.candidateCommit)
  ) {
    invalidEvidence();
  }
}

function assertTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    new Date(value).toISOString() !== value
  ) {
    invalidEvidence();
  }
}

async function verifyBackupPhase({ artifactContract, batchRoot, evidenceIo, phase }) {
  const phaseRoot = join(batchRoot, phase);
  await assertSecureDirectory(evidenceIo, phaseRoot);
  assertExactEntries(await evidenceIo.readdir(phaseRoot), [
    "backup-manifest.json",
    "database.dump",
  ]);
  const dumpPath = join(phaseRoot, "database.dump");
  const before = await assertSecureFile(evidenceIo, dumpPath, Number.MAX_SAFE_INTEGER);
  const manifest = await readCanonicalJson(evidenceIo, join(phaseRoot, "backup-manifest.json"));
  assertExactKeys(manifest, backupManifestKeys);
  assertCommonManifest(manifest, artifactContract);
  assertTimestamp(manifest.capturedAt);
  const digest = await evidenceIo.hashFile(dumpPath);
  const after = await assertSecureFile(evidenceIo, dumpPath, Number.MAX_SAFE_INTEGER);
  const expectedHead =
    phase === "pre" ? artifactContract.preMigrationHead : artifactContract.postMigrationHead;
  if (
    manifest.contract !== "huayi-hosted-important-batch-logical-backup/v1" ||
    manifest.phase !== phase ||
    manifest.connectionProfile !== "verify-full-administrator" ||
    manifest.dumpFormat !== "postgres-custom" ||
    manifest.dumpFile !== "database.dump" ||
    manifest.migrationHead !== expectedHead ||
    manifest.dumpBytes !== before.size ||
    after.size !== before.size ||
    !/^[0-9a-f]{64}$/u.test(manifest.dumpSha256) ||
    digest !== manifest.dumpSha256
  ) {
    invalidEvidence();
  }
  return manifest;
}

async function verifyRebuildPhase({ artifactContract, batchRoot, evidenceIo }) {
  const rebuildRoot = join(batchRoot, "rebuild");
  await assertSecureDirectory(evidenceIo, rebuildRoot);
  assertExactEntries(await evidenceIo.readdir(rebuildRoot), ["rebuild-verification.json"]);
  const manifest = await readCanonicalJson(
    evidenceIo,
    join(rebuildRoot, "rebuild-verification.json"),
  );
  assertExactKeys(manifest, rebuildManifestKeys);
  assertCommonManifest(manifest, artifactContract);
  assertTimestamp(manifest.completedAt);
  if (
    manifest.contract !== "huayi-hosted-important-batch-rebuild-verification/v1" ||
    manifest.migrationHead !== artifactContract.rebuildMigrationHead ||
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

export function verifyHostedImportantBatchEvidencePhase({
  artifactContract,
  batchRoot,
  evidenceIo,
  phase,
}) {
  assertHostedImportantBatchArtifactContract(artifactContract);
  if (phase === "pre" || phase === "post") {
    return verifyBackupPhase({ artifactContract, batchRoot, evidenceIo, phase });
  }
  if (phase === "rebuild") {
    return verifyRebuildPhase({ artifactContract, batchRoot, evidenceIo });
  }
  return Promise.reject(new Error("Hosted important-batch evidence phase is invalid."));
}

export async function verifyHostedImportantBatchEvidence({
  artifactContract,
  evidenceIo = realHostedImportantBatchEvidenceIo,
  mode,
  readRepositoryState,
  root,
}) {
  assertHostedImportantBatchArtifactContract(artifactContract);
  const state = await readRepositoryState(root);
  if (
    state.artifactRootIgnored !== true ||
    !/^[0-9a-f]{40}$/u.test(state.candidateCommit) ||
    state.upstreamExact !== true ||
    state.worktreeClean !== true
  ) {
    invalidEvidence();
  }
  const artifactRoot = join(root, secureArtifactRoot);
  const batchRoot = join(root, artifactContract.artifactDirectory);
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
  } else if (mode === "completion") {
    assertExactEntries(entries, ["post", "pre", "rebuild"]);
  } else {
    invalidEvidence();
  }
  const pre = await verifyBackupPhase({ artifactContract, batchRoot, evidenceIo, phase: "pre" });
  const rebuild = await verifyRebuildPhase({ artifactContract, batchRoot, evidenceIo });
  if (
    pre.candidateCommit !== state.candidateCommit ||
    rebuild.candidateCommit !== state.candidateCommit
  ) {
    invalidEvidence();
  }
  if (mode === "completion" || entries.includes("post")) {
    const post = await verifyBackupPhase({
      artifactContract,
      batchRoot,
      evidenceIo,
      phase: "post",
    });
    if (post.candidateCommit !== state.candidateCommit) invalidEvidence();
  }
}

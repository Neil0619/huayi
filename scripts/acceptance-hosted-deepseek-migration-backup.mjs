import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostedDeepseekMigrationArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

export const hostedDeepseekMigrationBackupId = hostedDeepseekMigrationArtifactContract.batchId;
export const hostedDeepseekMigrationBackupArtifactDirectory =
  hostedDeepseekMigrationArtifactContract.artifactDirectory;
export const hostedDeepseekMigrationBackupPreflightArgument = `--verify-pre-hosted-deepseek-0016-0021-backup-${hostedAcceptanceProjectRef}`;
export const hostedDeepseekMigrationBackupCompletionArgument = `--verify-post-hosted-deepseek-0016-0021-backup-${hostedAcceptanceProjectRef}`;

function invalidEvidence() {
  throw new Error("Hosted DeepSeek migration backup evidence is invalid.");
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

const realEvidenceIo = Object.freeze({ hashFile, lstat, readFile, readdir });

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

export async function readHostedDeepseekMigrationBackupRepositoryState(root) {
  const [head, upstream, ignored, status] = await Promise.all([
    runGit(["rev-parse", "--verify", "HEAD"], root, { captureOutput: true }),
    runGit(["rev-parse", "--verify", "@{upstream}"], root, { captureOutput: true }),
    runGit(["check-ignore", "--quiet", "--", hostedDeepseekMigrationBackupArtifactDirectory], root),
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

function assertCommonManifest(document) {
  if (
    document.projectRef !== hostedAcceptanceProjectRef ||
    document.batchId !== hostedDeepseekMigrationBackupId ||
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

async function verifyBackupPhase({ batchRoot, evidenceIo, phase }) {
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
  assertCommonManifest(manifest);
  assertTimestamp(manifest.capturedAt);
  const digest = await evidenceIo.hashFile(dumpPath);
  const after = await assertSecureFile(evidenceIo, dumpPath, Number.MAX_SAFE_INTEGER);
  const expectedHead =
    phase === "pre"
      ? hostedDeepseekMigrationArtifactContract.preMigrationHead
      : hostedDeepseekMigrationArtifactContract.postMigrationHead;
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

async function verifyRebuildPhase({ batchRoot, evidenceIo }) {
  const rebuildRoot = join(batchRoot, "rebuild");
  await assertSecureDirectory(evidenceIo, rebuildRoot);
  assertExactEntries(await evidenceIo.readdir(rebuildRoot), ["rebuild-verification.json"]);
  const manifest = await readCanonicalJson(
    evidenceIo,
    join(rebuildRoot, "rebuild-verification.json"),
  );
  assertExactKeys(manifest, rebuildManifestKeys);
  assertCommonManifest(manifest);
  assertTimestamp(manifest.completedAt);
  if (
    manifest.contract !== "huayi-hosted-important-batch-rebuild-verification/v1" ||
    manifest.migrationHead !== hostedDeepseekMigrationArtifactContract.rebuildMigrationHead ||
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

export function verifyHostedDeepseekMigrationEvidencePhase({ batchRoot, evidenceIo, phase }) {
  if (phase === "pre" || phase === "post") {
    return verifyBackupPhase({ batchRoot, evidenceIo, phase });
  }
  if (phase === "rebuild") return verifyRebuildPhase({ batchRoot, evidenceIo });
  return Promise.reject(new Error("Hosted DeepSeek migration evidence phase is invalid."));
}

async function verifyEvidence({ evidenceIo, mode, readRepositoryState, root }) {
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
  const batchRoot = join(root, hostedDeepseekMigrationBackupArtifactDirectory);
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
  const pre = await verifyBackupPhase({ batchRoot, evidenceIo, phase: "pre" });
  const rebuild = await verifyRebuildPhase({ batchRoot, evidenceIo });
  if (
    pre.candidateCommit !== state.candidateCommit ||
    rebuild.candidateCommit !== state.candidateCommit
  ) {
    invalidEvidence();
  }
  if (mode === "completion" || entries.includes("post")) {
    const post = await verifyBackupPhase({ batchRoot, evidenceIo, phase: "post" });
    if (post.candidateCommit !== state.candidateCommit) invalidEvidence();
  }
}

export function renderHostedDeepseekMigrationBackupPlan() {
  return `Hosted DeepSeek 0016-0021 backup/rebuild plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedDeepseekMigrationBackupId}.
Evidence directory: ${hostedDeepseekMigrationBackupArtifactDirectory}
- Phase 91 evidence stays immutable and is never read as 0016-0021 evidence.
- The independent pre backup requires migration head 20260825010000.
- The isolated rebuild and post backup require 21 repository migrations through 20260827060000.
- Preflight requires clean pushed exact-candidate pre and rebuild evidence; completion adds post.
- This plan performs no filesystem, Git, database, mail, model, deployment, or secret operation.
`;
}

export async function runHostedDeepseekMigrationBackupCli({
  arguments_ = process.argv.slice(2),
  evidenceIo = realEvidenceIo,
  readRepositoryState = readHostedDeepseekMigrationBackupRepositoryState,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedDeepseekMigrationBackupPlan());
    return 0;
  }
  const mode =
    arguments_.length === 1 && arguments_[0] === hostedDeepseekMigrationBackupPreflightArgument
      ? "preflight"
      : arguments_.length === 1 && arguments_[0] === hostedDeepseekMigrationBackupCompletionArgument
        ? "completion"
        : null;
  if (mode === null) {
    writeError("Hosted DeepSeek migration backup arguments are invalid.\n");
    return 1;
  }
  try {
    await verifyEvidence({ evidenceIo, mode, readRepositoryState, root });
    writeOutput(
      mode === "preflight"
        ? "Hosted DeepSeek migration backup preflight evidence passed.\n"
        : "Hosted DeepSeek migration backup completion evidence passed.\n",
    );
    return 0;
  } catch {
    writeError("Hosted DeepSeek migration backup evidence verification failed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeepseekMigrationBackupCli();
}

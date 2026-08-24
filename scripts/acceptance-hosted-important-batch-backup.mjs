import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const secureArtifactRoot = "artifacts/hosted-important-batch-backups";
const preMigrationHead = "20260823010000";
const postMigrationHead = "20260824010000";
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

export const hostedImportantBatchId = "phase-81-0014";
export const hostedImportantBatchBackupArtifactDirectory = `${secureArtifactRoot}/${hostedImportantBatchId}`;
export const hostedImportantBatchBackupPreflightArgument = `--verify-pre-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;
export const hostedImportantBatchBackupCompletionArgument = `--verify-post-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;

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

export async function readHostedImportantBatchBackupRepositoryState(root) {
  const [head, ignored, status] = await Promise.all([
    runGit(["rev-parse", "--verify", "HEAD"], root, { captureOutput: true }),
    runGit(["check-ignore", "--quiet", "--", hostedImportantBatchBackupArtifactDirectory], root),
    runGit(["status", "--porcelain=v1", "--untracked-files=normal"], root, {
      captureOutput: true,
    }),
  ]);
  const candidateCommit = head.code === 0 ? head.stdout.trim() : "";
  if (!/^[0-9a-f]{40}$/u.test(candidateCommit)) {
    throw new Error("Hosted important-batch repository state is invalid.");
  }
  return {
    artifactRootIgnored: ignored.code === 0,
    candidateCommit,
    worktreeClean: status.code === 0 && status.stdout.length === 0,
  };
}

function assertExactKeys(document, expectedKeys) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
  const actualKeys = Object.keys(document).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((value, index) => value !== sortedExpectedKeys[index])
  ) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
}

function assertIsoTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
}

function assertExactEntries(actual, expected) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((value, index) => value !== sortedExpected[index])
  ) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
}

async function assertSecureDirectory(evidenceIo, path) {
  const stats = await evidenceIo.lstat(path);
  if (!stats.isDirectory() || (stats.mode & 0o777) !== 0o700) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
}

async function assertSecureFile(evidenceIo, path, { maximumBytes, requireContent = true }) {
  const stats = await evidenceIo.lstat(path);
  if (
    !stats.isFile() ||
    (stats.mode & 0o777) !== 0o600 ||
    !Number.isSafeInteger(stats.size) ||
    stats.size < (requireContent ? 1 : 0) ||
    stats.size > maximumBytes
  ) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
  return stats;
}

async function readJsonEvidence(evidenceIo, path) {
  await assertSecureFile(evidenceIo, path, { maximumBytes: 4_096 });
  const source = await evidenceIo.readFile(path, "utf8");
  if (typeof source !== "string" || Buffer.byteLength(source) > 4_096) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
  try {
    const document = JSON.parse(source);
    if (source !== `${JSON.stringify(document)}\n`) {
      throw new Error("Hosted important-batch evidence is invalid.");
    }
    return document;
  } catch {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
}

function assertCommonManifest(document, repositoryState) {
  if (
    document.projectRef !== hostedAcceptanceProjectRef ||
    document.batchId !== hostedImportantBatchId ||
    document.candidateCommit !== repositoryState.candidateCommit
  ) {
    throw new Error("Hosted important-batch evidence is invalid.");
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
  const dumpStats = await assertSecureFile(evidenceIo, dumpPath, {
    maximumBytes: Number.MAX_SAFE_INTEGER,
  });
  const manifest = await readJsonEvidence(evidenceIo, join(phaseRoot, "backup-manifest.json"));
  assertExactKeys(manifest, backupManifestKeys);
  assertCommonManifest(manifest, repositoryState);
  assertIsoTimestamp(manifest.capturedAt);
  const expectedMigrationHead = phase === "pre" ? preMigrationHead : postMigrationHead;
  const dumpSha256 = await evidenceIo.hashFile(dumpPath);
  const finalDumpStats = await assertSecureFile(evidenceIo, dumpPath, {
    maximumBytes: Number.MAX_SAFE_INTEGER,
  });
  if (
    manifest.contract !== "huayi-hosted-important-batch-logical-backup/v1" ||
    manifest.phase !== phase ||
    manifest.connectionProfile !== "verify-full-administrator" ||
    manifest.dumpFormat !== "postgres-custom" ||
    manifest.dumpFile !== "database.dump" ||
    manifest.migrationHead !== expectedMigrationHead ||
    manifest.dumpBytes !== dumpStats.size ||
    finalDumpStats.size !== dumpStats.size ||
    !/^[0-9a-f]{64}$/u.test(manifest.dumpSha256) ||
    dumpSha256 !== manifest.dumpSha256
  ) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
}

async function verifyRebuildEvidence({ batchRoot, evidenceIo, repositoryState }) {
  const rebuildRoot = join(batchRoot, "rebuild");
  await assertSecureDirectory(evidenceIo, rebuildRoot);
  assertExactEntries(await evidenceIo.readdir(rebuildRoot), ["rebuild-verification.json"]);
  const manifest = await readJsonEvidence(
    evidenceIo,
    join(rebuildRoot, "rebuild-verification.json"),
  );
  assertExactKeys(manifest, rebuildManifestKeys);
  assertCommonManifest(manifest, repositoryState);
  assertIsoTimestamp(manifest.completedAt);
  if (
    manifest.contract !== "huayi-hosted-important-batch-rebuild-verification/v1" ||
    manifest.migrationHead !== postMigrationHead ||
    manifest.rebuildSource !== "repository-migrations-and-fictional-seed" ||
    manifest.fictionalSeedExact !== true ||
    manifest.hostedDataAbsent !== true ||
    manifest.migrationChainExact !== true ||
    manifest.runtimeContractExact !== true ||
    manifest.scratchDestroyed !== true
  ) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
}

async function verifyEvidence({ evidenceIo, mode, readState, root }) {
  const state = await readState(root);
  if (
    state.artifactRootIgnored !== true ||
    !/^[0-9a-f]{40}$/u.test(state.candidateCommit) ||
    state.worktreeClean !== true
  ) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
  const artifactRoot = join(root, secureArtifactRoot);
  const batchRoot = join(artifactRoot, hostedImportantBatchId);
  await assertSecureDirectory(evidenceIo, artifactRoot);
  await assertSecureDirectory(evidenceIo, batchRoot);
  const batchEntries = await evidenceIo.readdir(batchRoot);
  if (mode === "preflight") {
    if (
      !batchEntries.includes("pre") ||
      !batchEntries.includes("rebuild") ||
      batchEntries.some((entry) => !new Set(["pre", "post", "rebuild"]).has(entry))
    ) {
      throw new Error("Hosted important-batch evidence is invalid.");
    }
  } else {
    assertExactEntries(batchEntries, ["post", "pre", "rebuild"]);
  }
  await verifyBackupEvidence({ batchRoot, evidenceIo, phase: "pre", repositoryState: state });
  await verifyRebuildEvidence({ batchRoot, evidenceIo, repositoryState: state });
  if (mode === "completion" || batchEntries.includes("post")) {
    await verifyBackupEvidence({ batchRoot, evidenceIo, phase: "post", repositoryState: state });
  }
}

export function renderHostedImportantBatchBackupPlan() {
  return `Hosted important-batch backup/rebuild plan (zero network / zero write)
Pinned target: Supabase project ${hostedAcceptanceProjectRef}; batch ${hostedImportantBatchId}.
Evidence directory: ${hostedImportantBatchBackupArtifactDirectory}
- This plan performs no filesystem, Git, database, mail, model, or deployment operation.
- Real capture and restore are not implemented. Run acceptance:hosted:backup:executor:plan for the fail-closed runtime-readiness audit before requesting a separately approved stage.
Future controlled logical-backup contract:
- Use only the fixed project through a verify-full administrator profile and a process-scoped secret.
- Use the fixed session pooler on port 5432 with a repository-pinned PostgreSQL 17 runtime. The transaction pooler on 6543 and the Supabase CLI filtered SQL dump are not postgres-custom evidence.
- Write PostgreSQL custom format through an explicit file path; never stream database rows to stdout.
- The database archive may cover Auth rows and Storage metadata only after fixed internal checks; it never covers Storage object bytes, global roles, or hosted platform configuration.
- Treat the artifact as a raw sensitive logical dump, not as anonymized or shareable evidence.
- Create protected directories with mode 0700 and files with mode 0600; remove partial, CA, and temporary files on every failure.
- Hash the closed dump, then atomically create the strict body-free manifest; never print the dump, identities, content, or raw errors.
Rebuild-verification contract:
- Rebuild an isolated non-production scratch database only from repository migrations plus fictional seed.
- Record only fixed booleans, migration head, candidate commit, and cleanup completion; hosted data must be absent.
- Destroy the scratch database before recording success. A dump listing or command exit alone is insufficient.
Phase 81 dependency gates:
- Evidence verification requires a clean current candidate; manifests must match its exact commit.
- migration 0014 is not ready until the fixed preflight verifies the pre-backup and rebuild evidence.
- The important batch is not complete until the post-backup and completion gate also pass.
`;
}

export async function runHostedImportantBatchBackupCli({
  arguments_ = process.argv.slice(2),
  evidenceIo = realEvidenceIo,
  readRepositoryState: readState = readHostedImportantBatchBackupRepositoryState,
  repositoryRoot: root = repositoryRoot,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedImportantBatchBackupPlan());
    return 0;
  }
  const mode =
    arguments_.length === 1 && arguments_[0] === hostedImportantBatchBackupPreflightArgument
      ? "preflight"
      : arguments_.length === 1 && arguments_[0] === hostedImportantBatchBackupCompletionArgument
        ? "completion"
        : null;
  if (mode === null) {
    writeError("Hosted important-batch backup arguments are invalid.\n");
    return 1;
  }
  try {
    await verifyEvidence({ evidenceIo, mode, readState, root });
    writeOutput(
      mode === "preflight"
        ? "Hosted important-batch backup preflight evidence passed.\n"
        : "Hosted important-batch backup completion evidence passed.\n",
    );
    return 0;
  } catch {
    writeError("Hosted important-batch backup evidence verification failed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedImportantBatchBackupCli();
}

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  hostedDeepseekMigrationBackupArtifactDirectory,
  hostedDeepseekMigrationBackupId,
  verifyHostedDeepseekMigrationEvidencePhase,
} from "./acceptance-hosted-deepseek-migration-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commitPattern = /^[0-9a-f]{40}$/u;

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

export const hostedDeepseekMigrationBackupRetirementHistoryDirectory =
  "artifacts/hosted-important-batch-backup-history";
export const hostedDeepseekMigrationBackupRetirementArgument = `--confirm-retire-stale-hosted-deepseek-0016-0021-backup-${hostedAcceptanceProjectRef}`;

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

export async function readHostedDeepseekMigrationBackupRetirementRepositoryState(
  root,
  { runGit = (arguments_) => runGitProcess(arguments_, root) } = {},
) {
  const [head, upstream, status, activeIgnored, historyIgnored] = await Promise.all([
    runGit(["rev-parse", "--verify", "HEAD"]),
    runGit(["rev-parse", "--verify", "@{upstream}"]),
    runGit(["status", "--porcelain=v1", "--untracked-files=normal"]),
    runGit(["check-ignore", "--quiet", "--", hostedDeepseekMigrationBackupArtifactDirectory]),
    runGit([
      "check-ignore",
      "--quiet",
      "--",
      hostedDeepseekMigrationBackupRetirementHistoryDirectory,
    ]),
  ]);
  const candidateCommit = head.code === 0 ? head.stdout.trim() : "";
  const upstreamCommit = upstream.code === 0 ? upstream.stdout.trim() : "";
  return {
    activeRootIgnored: activeIgnored.code === 0 && activeIgnored.stdout === "",
    candidateCommit,
    historyRootIgnored: historyIgnored.code === 0 && historyIgnored.stdout === "",
    upstreamExact: commitPattern.test(upstreamCommit) && upstreamCommit === candidateCommit,
    worktreeClean: status.code === 0 && status.stdout === "",
  };
}

export async function verifyHostedDeepseekMigrationBackupRetirementHistoricalCommit(
  root,
  candidateCommit,
  { runGit = (arguments_) => runGitProcess(arguments_, root) } = {},
) {
  if (!commitPattern.test(candidateCommit)) return false;
  const exists = await runGit(["cat-file", "-e", `${candidateCommit}^{commit}`]);
  if (exists.code !== 0 || exists.stdout !== "") return false;
  const ancestor = await runGit(["merge-base", "--is-ancestor", candidateCommit, "HEAD"]);
  return ancestor.code === 0 && ancestor.stdout === "";
}

function assertRepositoryState(state) {
  if (
    state === null ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    !commitPattern.test(state.candidateCommit) ||
    state.activeRootIgnored !== true ||
    state.historyRootIgnored !== true ||
    state.upstreamExact !== true ||
    state.worktreeClean !== true
  ) {
    throw new Error("Hosted DeepSeek migration stale backup retirement is unsafe.");
  }
}

function invalidRetirement() {
  throw new Error("Hosted DeepSeek migration stale backup retirement is unsafe.");
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
  if (!stats.isDirectory() || (stats.mode & 0o777) !== 0o700) invalidRetirement();
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

function assertExactEntries(entries, expected) {
  const actual = [...entries].sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((entry, index) => entry !== wanted[index])) {
    invalidRetirement();
  }
}

async function verifyStrictUnit({ batchRoot, evidenceIo, expectedCommit }) {
  await assertPrivateDirectory(evidenceIo, batchRoot);
  assertExactEntries(await evidenceIo.readdir(batchRoot), ["pre", "rebuild"]);
  const [pre, rebuild] = await Promise.all([
    verifyHostedDeepseekMigrationEvidencePhase({ batchRoot, evidenceIo, phase: "pre" }),
    verifyHostedDeepseekMigrationEvidencePhase({ batchRoot, evidenceIo, phase: "rebuild" }),
  ]);
  if (
    pre.candidateCommit !== rebuild.candidateCommit ||
    (expectedCommit !== undefined && pre.candidateCommit !== expectedCommit)
  ) {
    invalidRetirement();
  }
  return pre.candidateCommit;
}

export async function retireHostedDeepseekMigrationBackup({
  directorySync = syncDirectory,
  evidenceIo = realEvidenceIo,
  postMoveAudit = async () => undefined,
  readRepositoryState = readHostedDeepseekMigrationBackupRetirementRepositoryState,
  renameBatch = rename,
  repositoryRoot: root = repositoryRoot,
  verifyHistoricalCommit = verifyHostedDeepseekMigrationBackupRetirementHistoricalCommit,
} = {}) {
  const state = await readRepositoryState(root);
  assertRepositoryState(state);

  const activeBatch = join(root, hostedDeepseekMigrationBackupArtifactDirectory);
  const activeRoot = dirname(activeBatch);
  await assertPrivateDirectory(evidenceIo, activeRoot);
  const staleCommit = await verifyStrictUnit({ batchRoot: activeBatch, evidenceIo });
  if (staleCommit === state.candidateCommit || !(await verifyHistoricalCommit(root, staleCommit))) {
    invalidRetirement();
  }
  const mutationState = await readRepositoryState(root);
  assertRepositoryState(mutationState);
  if (mutationState.candidateCommit !== state.candidateCommit) invalidRetirement();

  const historyRoot = join(root, hostedDeepseekMigrationBackupRetirementHistoryDirectory);
  const historyBatch = join(historyRoot, hostedDeepseekMigrationBackupId);
  const candidateRoot = join(historyBatch, staleCommit);
  const retainedBatch = join(candidateRoot, "evidence");
  if (await pathExists(evidenceIo, candidateRoot)) invalidRetirement();

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
    await directorySync(candidateRoot);
    await directorySync(historyBatch);
    const finalState = await readRepositoryState(root);
    assertRepositoryState(finalState);
    if (finalState.candidateCommit !== state.candidateCommit) invalidRetirement();
    await verifyStrictUnit({
      batchRoot: activeBatch,
      evidenceIo,
      expectedCommit: staleCommit,
    });
    await renameBatch(activeBatch, retainedBatch);
    moved = true;
    await directorySync(activeRoot);
    await directorySync(candidateRoot);
    await verifyStrictUnit({
      batchRoot: retainedBatch,
      evidenceIo,
      expectedCommit: staleCommit,
    });
    await postMoveAudit({ retainedBatch, staleCommit });
    await directorySync(candidateRoot);
    await directorySync(historyBatch);
  } catch (error) {
    if (!moved) {
      try {
        await rmdir(candidateRoot);
        await directorySync(historyBatch);
      } catch {
        // The complete active unit remains authoritative; an empty reservation is inspectable.
      }
    }
    throw error;
  }
}

export async function runHostedDeepseekMigrationBackupRetirementCli({
  arguments_ = process.argv.slice(2),
  retireEvidence = retireHostedDeepseekMigrationBackup,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedDeepseekMigrationBackupRetirementArgument
    ) {
      throw new Error("Hosted DeepSeek migration stale backup retirement arguments are invalid.");
    }
    await retireEvidence();
    writeOutput("Hosted DeepSeek migration stale backup evidence retired.\n");
    return 0;
  } catch {
    writeError("Hosted DeepSeek migration stale backup evidence retirement failed closed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeepseekMigrationBackupRetirementCli();
}

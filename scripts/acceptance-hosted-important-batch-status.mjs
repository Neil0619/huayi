import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import {
  hostedImportantBatchBackupArtifactDirectory,
  readHostedImportantBatchBackupRepositoryState,
  verifyHostedImportantBatchEvidencePhase,
} from "./acceptance-hosted-important-batch-backup.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

export const hostedImportantBatchStatusArgument = `--status-hosted-important-batch-backup-${hostedAcceptanceProjectRef}`;

const phases = Object.freeze(["pre", "rebuild", "post"]);
const verdicts = Object.freeze(["present", "valid", "current"]);

async function readSecureDirectoryEntriesIfPresent(evidenceIo, path) {
  try {
    const stats = await evidenceIo.lstat(path);
    if (!stats.isDirectory() || (stats.mode & 0o777) !== 0o700) {
      throw new Error("Hosted important-batch evidence is invalid.");
    }
    return await evidenceIo.readdir(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function inspectHostedImportantBatchEvidence({
  evidenceIo = realEvidenceIo,
  readRepositoryState: readState = readHostedImportantBatchBackupRepositoryState,
  repositoryRoot: root = repositoryRoot,
} = {}) {
  const state = await readState(root);
  if (
    !/^[0-9a-f]{40}$/u.test(state.candidateCommit) ||
    typeof state.artifactRootIgnored !== "boolean" ||
    typeof state.worktreeClean !== "boolean"
  ) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
  const empty = () => ({ current: false, present: false, valid: false });
  const status = { post: empty(), pre: empty(), rebuild: empty() };
  const batchRoot = join(root, hostedImportantBatchBackupArtifactDirectory);
  if ((await readSecureDirectoryEntriesIfPresent(evidenceIo, dirname(batchRoot))) === null) {
    return status;
  }
  const entries = await readSecureDirectoryEntriesIfPresent(evidenceIo, batchRoot);
  if (entries === null) return status;
  const allowedEntries = new Set(phases);
  if (
    new Set(entries).size !== entries.length ||
    entries.some((entry) => !allowedEntries.has(entry))
  ) {
    throw new Error("Hosted important-batch evidence is invalid.");
  }
  for (const phase of phases) {
    if (!entries.includes(phase)) continue;
    status[phase].present = true;
    try {
      const manifest = await verifyHostedImportantBatchEvidencePhase({
        batchRoot,
        evidenceIo,
        phase,
      });
      status[phase].valid = true;
      status[phase].current =
        state.artifactRootIgnored &&
        state.worktreeClean &&
        manifest.candidateCommit === state.candidateCommit;
    } catch {
      status[phase].valid = false;
      status[phase].current = false;
    }
  }
  return status;
}

function assertHostedImportantBatchStatus(status) {
  if (
    status === null ||
    typeof status !== "object" ||
    Array.isArray(status) ||
    Object.keys(status).length !== phases.length
  ) {
    throw new Error("Hosted important-batch backup status is invalid.");
  }
  for (const phase of phases) {
    const phaseStatus = status[phase];
    if (
      phaseStatus === null ||
      typeof phaseStatus !== "object" ||
      Array.isArray(phaseStatus) ||
      Object.keys(phaseStatus).length !== verdicts.length ||
      verdicts.some((verdict) => typeof phaseStatus[verdict] !== "boolean") ||
      (phaseStatus.valid && !phaseStatus.present) ||
      (phaseStatus.current && !phaseStatus.valid)
    ) {
      throw new Error("Hosted important-batch backup status is invalid.");
    }
  }
}

export function renderHostedImportantBatchStatus(status) {
  assertHostedImportantBatchStatus(status);
  return `${phases
    .flatMap((phase) =>
      verdicts.map((verdict) => `${phase}_${verdict}|${status[phase][verdict] ? "t" : "f"}`),
    )
    .join("\n")}\n`;
}

export async function runHostedImportantBatchStatusCli({
  arguments_ = process.argv.slice(2),
  inspectEvidence = inspectHostedImportantBatchEvidence,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (arguments_.length !== 1 || arguments_[0] !== hostedImportantBatchStatusArgument) {
      throw new Error("Hosted important-batch backup status arguments are invalid.");
    }
    writeOutput(renderHostedImportantBatchStatus(await inspectEvidence()));
    return 0;
  } catch {
    writeError("Hosted important-batch backup status failed closed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedImportantBatchStatusCli();
}

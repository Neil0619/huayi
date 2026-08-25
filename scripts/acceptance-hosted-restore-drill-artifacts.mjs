import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  hostedRestoreDrillArtifactRoot,
  validateHostedRestoreDrillEvidence,
} from "./acceptance-hosted-restore-drill-contract.mjs";

const evidenceFiles = Object.freeze({
  cleanupVerification: "target-cleanup-verification.json",
  failureVerification: "failure-verification.json",
  restoreVerification: "restore-verification.json",
  sourceAttestation: "source-attestation.json",
  sourceDisposition: "source-disposition.json",
  sourceRetentionVerification: "source-retention-verification.json",
  targetEmptyVerification: "target-empty-verification.json",
});
const appendTransitions = Object.freeze({
  "failed-cleaned-retention-pending": ["sourceDisposition", "sourceRetentionVerification"],
  "failed-cleanup-pending": ["cleanupVerification"],
  "failed-target-destroyed": ["sourceDisposition", "sourceRetentionVerification"],
  planned: ["sourceAttestation"],
  "restored-verified": ["cleanupVerification", "failureVerification"],
  "retention-pending": ["failureVerification", "sourceDisposition"],
  "source-bound": ["failureVerification", "targetEmptyVerification"],
  "target-destroyed": ["failureVerification", "sourceDisposition", "sourceRetentionVerification"],
  "target-empty": ["failureVerification", "restoreVerification"],
});

function fail() {
  throw new Error("Hosted restore-drill artifact store failed.");
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

async function assertDirectory(path, mode) {
  const stats = await lstat(path);
  if (!stats.isDirectory() || (stats.mode & 0o777) !== mode) fail();
}

async function ensureDirectory(path, mode) {
  try {
    await mkdir(path, { mode });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await assertDirectory(path, mode);
}

async function readDocument(path) {
  const stats = await lstat(path);
  if (
    !stats.isFile() ||
    (stats.mode & 0o777) !== 0o600 ||
    !Number.isSafeInteger(stats.size) ||
    stats.size < 3 ||
    stats.size > 16_384
  ) {
    fail();
  }
  const source = await readFile(path, "utf8");
  if (Buffer.byteLength(source) !== stats.size || Buffer.byteLength(source) > 16_384) fail();
  try {
    const document = JSON.parse(source);
    if (source !== `${JSON.stringify(document)}\n`) fail();
    return document;
  } catch {
    fail();
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

async function writeDocumentAtomically(directory, name, document) {
  const finalPath = join(directory, evidenceFiles[name]);
  const partialPath = `${finalPath}.partial`;
  if ((await pathExists(finalPath)) || (await pathExists(partialPath))) fail();
  let committed = false;
  try {
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
    committed = true;
  } finally {
    await rm(partialPath, { force: true });
    if (!committed) await rm(finalPath, { force: true });
  }
}

export function createHostedRestoreDrillArtifactStore({ expected, repositoryRoot }) {
  const secureRoot = join(repositoryRoot, hostedRestoreDrillArtifactRoot);
  const drillRoot = join(secureRoot, expected.drillId);

  async function read() {
    if (!(await pathExists(drillRoot))) {
      const documents = {};
      return {
        documents,
        lifecycle: validateHostedRestoreDrillEvidence({ documents, expected }),
      };
    }
    await assertDirectory(secureRoot, 0o700);
    await assertDirectory(drillRoot, 0o700);
    const entries = await readdir(drillRoot);
    const reverse = new Map(Object.entries(evidenceFiles).map(([name, file]) => [file, name]));
    if (
      entries.some((entry) => entry.endsWith(".partial") || !reverse.has(entry)) ||
      new Set(entries).size !== entries.length
    ) {
      fail();
    }
    const documents = {};
    for (const entry of entries) {
      documents[reverse.get(entry)] = await readDocument(join(drillRoot, entry));
    }
    return {
      documents,
      lifecycle: validateHostedRestoreDrillEvidence({ documents, expected }),
    };
  }

  async function append(name, document) {
    if (!Object.hasOwn(evidenceFiles, name)) fail();
    const current = await read();
    if (!appendTransitions[current.lifecycle]?.includes(name)) fail();
    const documents = { ...current.documents, [name]: document };
    validateHostedRestoreDrillEvidence({ documents, expected });
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await ensureDirectory(artifactsRoot, 0o755);
    await ensureDirectory(secureRoot, 0o700);
    await ensureDirectory(drillRoot, 0o700);
    await writeDocumentAtomically(drillRoot, name, document);
  }

  return Object.freeze({ append, read });
}

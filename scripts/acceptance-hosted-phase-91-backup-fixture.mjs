import { createHash } from "node:crypto";
import { join } from "node:path";

import { hostedPhase91BackupId } from "./acceptance-hosted-phase-91-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

export const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
export const repositoryRoot = join(process.cwd(), "virtual-phase-91-backup-repository");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createEvidenceFixture({ includePost = false } = {}) {
  const directories = new Map();
  const files = new Map();
  const hashes = new Map();
  const secureRoot = join(repositoryRoot, "artifacts", "hosted-important-batch-backups");
  const batchRoot = join(secureRoot, hostedPhase91BackupId);

  function addDirectory(path, entries, mode = 0o700) {
    directories.set(path, { entries, mode });
  }

  function addFile(path, contents, { hash = sha256(contents), mode = 0o600 } = {}) {
    files.set(path, { contents, mode, size: Buffer.byteLength(contents) });
    hashes.set(path, hash);
  }

  function addBackup(phase) {
    const phaseRoot = join(batchRoot, phase);
    const dump = `opaque-phase-91-${phase}-logical-dump`;
    const manifest = {
      batchId: hostedPhase91BackupId,
      candidateCommit,
      capturedAt: phase === "pre" ? "2026-08-26T01:00:00.000Z" : "2026-08-26T02:00:00.000Z",
      connectionProfile: "verify-full-administrator",
      contract: "huayi-hosted-important-batch-logical-backup/v1",
      dumpBytes: Buffer.byteLength(dump),
      dumpFile: "database.dump",
      dumpFormat: "postgres-custom",
      dumpSha256: sha256(dump),
      migrationHead: phase === "pre" ? "20260824010000" : "20260825010000",
      phase,
      projectRef: hostedAcceptanceProjectRef,
    };
    addDirectory(phaseRoot, ["backup-manifest.json", "database.dump"]);
    addFile(join(phaseRoot, "database.dump"), dump);
    addFile(join(phaseRoot, "backup-manifest.json"), `${JSON.stringify(manifest)}\n`);
  }

  addDirectory(secureRoot, ["phase-81-0014", hostedPhase91BackupId]);
  addDirectory(batchRoot, includePost ? ["post", "pre", "rebuild"] : ["pre", "rebuild"]);
  addBackup("pre");
  if (includePost) addBackup("post");
  const rebuildRoot = join(batchRoot, "rebuild");
  addDirectory(rebuildRoot, ["rebuild-verification.json"]);
  addFile(
    join(rebuildRoot, "rebuild-verification.json"),
    `${JSON.stringify({
      batchId: hostedPhase91BackupId,
      candidateCommit,
      completedAt: "2026-08-26T00:30:00.000Z",
      contract: "huayi-hosted-important-batch-rebuild-verification/v1",
      fictionalSeedExact: true,
      hostedDataAbsent: true,
      migrationChainExact: true,
      migrationHead: "20260825010000",
      projectRef: hostedAcceptanceProjectRef,
      rebuildSource: "repository-migrations-and-fictional-seed",
      runtimeContractExact: true,
      scratchDestroyed: true,
    })}\n`,
  );

  const evidenceIo = {
    async hashFile(path) {
      if (!hashes.has(path)) throw new Error("missing hash fixture");
      return hashes.get(path);
    },
    async lstat(path) {
      if (directories.has(path)) {
        return {
          isDirectory: () => true,
          isFile: () => false,
          mode: directories.get(path).mode,
          size: 0,
        };
      }
      if (files.has(path)) {
        return {
          isDirectory: () => false,
          isFile: () => true,
          mode: files.get(path).mode,
          size: files.get(path).size,
        };
      }
      throw new Error("missing stat fixture");
    },
    async readFile(path) {
      if (!files.has(path)) throw new Error("missing file fixture");
      return files.get(path).contents;
    },
    async readdir(path) {
      if (!directories.has(path)) throw new Error("missing directory fixture");
      return [...directories.get(path).entries];
    },
  };
  return {
    batchRoot,
    directories,
    evidenceIo,
    files,
    hashes,
    repositoryState: {
      artifactRootIgnored: true,
      candidateCommit,
      worktreeClean: true,
    },
  };
}

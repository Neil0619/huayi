import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  hostedImportantBatchBackupArtifactDirectory,
  hostedImportantBatchBackupCompletionArgument,
  hostedImportantBatchBackupPreflightArgument,
  hostedImportantBatchId,
  renderHostedImportantBatchBackupPlan,
  runHostedImportantBatchBackupCli,
} from "./acceptance-hosted-important-batch-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const repositoryRoot = join(process.cwd(), "virtual-hosted-backup-repository");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createEvidenceFixture({ includePost = false } = {}) {
  const directories = new Map();
  const files = new Map();
  const hashes = new Map();
  const secureRoot = join(repositoryRoot, "artifacts", "hosted-important-batch-backups");
  const batchRoot = join(secureRoot, hostedImportantBatchId);
  const rebuildRoot = join(batchRoot, "rebuild");

  function addDirectory(path, entries, mode = 0o700) {
    directories.set(path, { entries, mode });
  }

  function addFile(path, contents, { hash = sha256(contents), mode = 0o600 } = {}) {
    files.set(path, { contents, mode, size: Buffer.byteLength(contents) });
    hashes.set(path, hash);
  }

  function backupManifest(phase, dump) {
    return {
      batchId: hostedImportantBatchId,
      candidateCommit,
      capturedAt: phase === "pre" ? "2026-08-24T01:00:00.000Z" : "2026-08-24T02:00:00.000Z",
      connectionProfile: "verify-full-administrator",
      contract: "huayi-hosted-important-batch-logical-backup/v1",
      dumpBytes: Buffer.byteLength(dump),
      dumpFile: "database.dump",
      dumpFormat: "postgres-custom",
      dumpSha256: sha256(dump),
      migrationHead: phase === "pre" ? "20260823010000" : "20260824010000",
      phase,
      projectRef: hostedAcceptanceProjectRef,
    };
  }

  function addBackup(phase) {
    const phaseRoot = join(batchRoot, phase);
    const dump = `opaque-${phase}-logical-dump`;
    addDirectory(phaseRoot, ["backup-manifest.json", "database.dump"]);
    addFile(join(phaseRoot, "database.dump"), dump);
    addFile(
      join(phaseRoot, "backup-manifest.json"),
      `${JSON.stringify(backupManifest(phase, dump))}\n`,
    );
  }

  addDirectory(secureRoot, [hostedImportantBatchId]);
  addDirectory(batchRoot, includePost ? ["post", "pre", "rebuild"] : ["pre", "rebuild"]);
  addDirectory(rebuildRoot, ["rebuild-verification.json"]);
  addBackup("pre");
  if (includePost) addBackup("post");
  addFile(
    join(rebuildRoot, "rebuild-verification.json"),
    `${JSON.stringify({
      batchId: hostedImportantBatchId,
      candidateCommit,
      completedAt: "2026-08-24T00:30:00.000Z",
      contract: "huayi-hosted-important-batch-rebuild-verification/v1",
      fictionalSeedExact: true,
      hostedDataAbsent: true,
      migrationChainExact: true,
      migrationHead: "20260824010000",
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
        const directory = directories.get(path);
        return {
          isDirectory: () => true,
          isFile: () => false,
          mode: directory.mode,
          size: 0,
        };
      }
      if (files.has(path)) {
        const file = files.get(path);
        return {
          isDirectory: () => false,
          isFile: () => true,
          mode: file.mode,
          size: file.size,
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

async function runCli({ arguments_, fixture = createEvidenceFixture(), repositoryState } = {}) {
  let stdout = "";
  let stderr = "";
  let repositoryReads = 0;
  const code = await runHostedImportantBatchBackupCli({
    arguments_,
    evidenceIo: fixture.evidenceIo,
    readRepositoryState: async () => {
      repositoryReads += 1;
      return repositoryState ?? fixture.repositoryState;
    },
    repositoryRoot,
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  return { code, repositoryReads, stderr, stdout };
}

test("hosted important-batch plan is deterministic, secret-free, and performs zero I/O", async () => {
  let calls = 0;
  let stdout = "";
  let stderr = "";
  const secret = "private-user@example.test";
  const code = await runHostedImportantBatchBackupCli({
    arguments_: ["--plan"],
    evidenceIo: {
      hashFile: async () => {
        calls += 1;
      },
      lstat: async () => {
        calls += 1;
      },
      readFile: async () => {
        calls += 1;
      },
      readdir: async () => {
        calls += 1;
      },
    },
    readRepositoryState: async () => {
      calls += 1;
      return { artifactRootIgnored: true, candidateCommit };
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, renderHostedImportantBatchBackupPlan());
  assert.match(stdout, /zero network \/ zero write/u);
  assert.match(stdout, new RegExp(hostedAcceptanceProjectRef, "u"));
  assert.match(stdout, /verify-full administrator/u);
  assert.match(stdout, new RegExp(hostedImportantBatchBackupArtifactDirectory, "u"));
  assert.match(stdout, /raw sensitive logical dump/u);
  assert.match(stdout, /separately approved/u);
  assert.match(stdout, /migration 0014 is not ready/u);
  assert.doesNotMatch(stdout, /Real capture and restore are not implemented/u);
  assert.match(
    stdout,
    /Reviewed capture and rebuild entrypoints are implemented but have not yet completed successfully/u,
  );
  assert.match(stdout, /acceptance:hosted:backup:capture:pre/u);
  assert.match(stdout, /acceptance:hosted:backup:rebuild/u);
  assert.match(stdout, /acceptance:hosted:backup:capture:post/u);
  assert.match(stdout, /Hosted dump restore is not implemented/u);
  assert.doesNotMatch(stdout, new RegExp(secret, "u"));
  assert.doesNotMatch(stdout, /row body|user body|pseudo-anonymized/iu);
});

test("package scripts expose only offline plan and evidence verification interfaces", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:plan"],
    "node scripts/acceptance-hosted-important-batch-backup.mjs --plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:preflight"],
    `node scripts/acceptance-hosted-important-batch-backup.mjs ${hostedImportantBatchBackupPreflightArgument}`,
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:complete"],
    `node scripts/acceptance-hosted-important-batch-backup.mjs ${hostedImportantBatchBackupCompletionArgument}`,
  );
  assert.equal(packageDocument.scripts["acceptance:hosted:backup:capture"], undefined);
  assert.equal(packageDocument.scripts["acceptance:hosted:backup:restore"], undefined);
});

test("preflight verifies the fixed pre-backup and clean migrations-plus-seed rebuild evidence", async () => {
  const result = await runCli({ arguments_: [hostedImportantBatchBackupPreflightArgument] });

  assert.equal(result.code, 0);
  assert.equal(result.repositoryReads, 1);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "Hosted important-batch backup preflight evidence passed.\n");
});

test("completion requires secure pre and post backups plus the same rebuild evidence", async () => {
  const fixture = createEvidenceFixture({ includePost: true });
  const result = await runCli({
    arguments_: [hostedImportantBatchBackupCompletionArgument],
    fixture,
  });

  assert.equal(result.code, 0);
  assert.equal(result.repositoryReads, 1);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "Hosted important-batch backup completion evidence passed.\n");
});

test("evidence verification fails closed on stale, dirty, insecure, or incomplete evidence", async () => {
  const cases = [];

  cases.push({
    fixture: createEvidenceFixture(),
    repositoryState: { artifactRootIgnored: false, candidateCommit, worktreeClean: true },
  });
  cases.push({
    fixture: createEvidenceFixture(),
    repositoryState: {
      artifactRootIgnored: true,
      candidateCommit: "f".repeat(40),
      worktreeClean: true,
    },
  });
  cases.push({
    fixture: createEvidenceFixture(),
    repositoryState: { artifactRootIgnored: true, candidateCommit, worktreeClean: false },
  });

  const insecure = createEvidenceFixture();
  insecure.directories.get(insecure.batchRoot).mode = 0o755;
  cases.push({ fixture: insecure });

  const insecureFile = createEvidenceFixture();
  insecureFile.files.get(join(insecureFile.batchRoot, "pre", "database.dump")).mode = 0o644;
  cases.push({ fixture: insecureFile });

  const partial = createEvidenceFixture();
  partial.directories.get(join(partial.batchRoot, "pre")).entries.push("database.dump.partial");
  cases.push({ fixture: partial });

  const wrongHash = createEvidenceFixture();
  wrongHash.hashes.set(join(wrongHash.batchRoot, "pre", "database.dump"), "f".repeat(64));
  cases.push({ fixture: wrongHash });

  const reflectedIdentity = createEvidenceFixture();
  const manifestPath = join(reflectedIdentity.batchRoot, "pre", "backup-manifest.json");
  const manifest = JSON.parse(reflectedIdentity.files.get(manifestPath).contents);
  manifest.email = "private-user@example.test";
  reflectedIdentity.files.get(manifestPath).contents = `${JSON.stringify(manifest)}\n`;
  reflectedIdentity.files.get(manifestPath).size = Buffer.byteLength(
    reflectedIdentity.files.get(manifestPath).contents,
  );
  cases.push({ fixture: reflectedIdentity });

  const nonCanonical = createEvidenceFixture();
  const nonCanonicalPath = join(nonCanonical.batchRoot, "rebuild", "rebuild-verification.json");
  nonCanonical.files.get(nonCanonicalPath).contents =
    `${nonCanonical.files.get(nonCanonicalPath).contents.trim()}  \n`;
  nonCanonical.files.get(nonCanonicalPath).size = Buffer.byteLength(
    nonCanonical.files.get(nonCanonicalPath).contents,
  );
  cases.push({ fixture: nonCanonical });

  for (const candidate of cases) {
    const result = await runCli({
      arguments_: [hostedImportantBatchBackupPreflightArgument],
      ...candidate,
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Hosted important-batch backup evidence verification failed.\n");
    assert.doesNotMatch(result.stderr, /private-user@example\.test/u);
  }

  const missingPost = await runCli({
    arguments_: [hostedImportantBatchBackupCompletionArgument],
  });
  assert.equal(missingPost.code, 1);
  assert.equal(missingPost.stdout, "");
  assert.equal(missingPost.stderr, "Hosted important-batch backup evidence verification failed.\n");
});

test("CLI rejects every variable path, project, or operation argument without reflecting it", async () => {
  const secret = "private-user@example.test";
  for (const arguments_ of [
    [],
    ["capture"],
    [hostedImportantBatchBackupPreflightArgument, "--output", secret],
    ["--verify-pre-0014-important-batch-backup-other-project"],
  ]) {
    const result = await runCli({ arguments_ });
    assert.equal(result.code, 1);
    assert.equal(result.repositoryReads, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Hosted important-batch backup arguments are invalid.\n");
    assert.doesNotMatch(result.stderr, new RegExp(secret, "u"));
  }
});

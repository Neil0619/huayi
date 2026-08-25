import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  hostedPhase91BackupArtifactDirectory,
  hostedPhase91BackupCompletionArgument,
  hostedPhase91BackupId,
  hostedPhase91BackupPreflightArgument,
  renderHostedPhase91BackupPlan,
  runHostedPhase91BackupCli,
  verifyHostedPhase91EvidencePhase,
} from "./acceptance-hosted-phase-91-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const repositoryRoot = join(process.cwd(), "virtual-phase-91-backup-repository");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createEvidenceFixture({ includePost = false } = {}) {
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

async function runCli({ arguments_, fixture = createEvidenceFixture(), repositoryState } = {}) {
  let stderr = "";
  let stdout = "";
  let repositoryReads = 0;
  const code = await runHostedPhase91BackupCli({
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

test("Phase 91 backup has an independent fixed identity and package surface", async () => {
  assert.equal(hostedPhase91BackupId, "phase-91-0015-public-function-acl-hardening");
  assert.equal(
    hostedPhase91BackupArtifactDirectory,
    "artifacts/hosted-important-batch-backups/phase-91-0015-public-function-acl-hardening",
  );
  assert.match(hostedPhase91BackupPreflightArgument, /^--verify-pre-0015-/u);
  assert.match(hostedPhase91BackupCompletionArgument, /^--verify-post-0015-/u);
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase91:backup:plan"],
    "node scripts/acceptance-hosted-phase-91-backup.mjs --plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase91:backup:preflight"],
    `node scripts/acceptance-hosted-phase-91-backup.mjs ${hostedPhase91BackupPreflightArgument}`,
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase91:backup:complete"],
    `node scripts/acceptance-hosted-phase-91-backup.mjs ${hostedPhase91BackupCompletionArgument}`,
  );
});

test("Phase 91 backup plan performs zero I/O and never claims Phase 81 completion", async () => {
  let calls = 0;
  let stdout = "";
  const code = await runHostedPhase91BackupCli({
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
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.equal(stdout, renderHostedPhase91BackupPlan());
  assert.match(stdout, /zero network \/ zero write/u);
  assert.match(stdout, /20260824010000/u);
  assert.match(stdout, /20260825010000/u);
  assert.match(stdout, /phase-81-0014.+immutable/isu);
});

test("Phase 91 preflight and completion verify only their exact secure evidence", async () => {
  const preflight = await runCli({ arguments_: [hostedPhase91BackupPreflightArgument] });
  assert.deepEqual(preflight, {
    code: 0,
    repositoryReads: 1,
    stderr: "",
    stdout: "Hosted Phase 91 backup preflight evidence passed.\n",
  });

  const completed = await runCli({
    arguments_: [hostedPhase91BackupCompletionArgument],
    fixture: createEvidenceFixture({ includePost: true }),
  });
  assert.equal(completed.code, 0);
  assert.equal(completed.stdout, "Hosted Phase 91 backup completion evidence passed.\n");
});

test("Phase 91 evidence phase verifier rejects Phase 81 identity or migration heads", async () => {
  for (const { mutate, phase } of [
    {
      phase: "pre",
      mutate: (fixture) => {
        const path = join(fixture.batchRoot, "pre", "backup-manifest.json");
        const manifest = JSON.parse(fixture.files.get(path).contents);
        manifest.batchId = "phase-81-0014";
        fixture.files.get(path).contents = `${JSON.stringify(manifest)}\n`;
        fixture.files.get(path).size = Buffer.byteLength(fixture.files.get(path).contents);
      },
    },
    {
      phase: "pre",
      mutate: (fixture) => {
        const path = join(fixture.batchRoot, "pre", "backup-manifest.json");
        const manifest = JSON.parse(fixture.files.get(path).contents);
        manifest.migrationHead = "20260823010000";
        fixture.files.get(path).contents = `${JSON.stringify(manifest)}\n`;
        fixture.files.get(path).size = Buffer.byteLength(fixture.files.get(path).contents);
      },
    },
    {
      phase: "rebuild",
      mutate: (fixture) => {
        const path = join(fixture.batchRoot, "rebuild", "rebuild-verification.json");
        const manifest = JSON.parse(fixture.files.get(path).contents);
        manifest.migrationHead = "20260824010000";
        fixture.files.get(path).contents = `${JSON.stringify(manifest)}\n`;
        fixture.files.get(path).size = Buffer.byteLength(fixture.files.get(path).contents);
      },
    },
  ]) {
    const fixture = createEvidenceFixture();
    mutate(fixture);
    await assert.rejects(
      verifyHostedPhase91EvidencePhase({
        batchRoot: fixture.batchRoot,
        evidenceIo: fixture.evidenceIo,
        phase,
      }),
      /Phase 91 evidence is invalid/u,
    );
  }
});

test("Phase 91 evidence gate fails closed on stale, dirty, insecure, incomplete, or unknown input", async () => {
  const cases = [];
  cases.push({
    repositoryState: { artifactRootIgnored: false, candidateCommit, worktreeClean: true },
  });
  cases.push({
    repositoryState: { artifactRootIgnored: true, candidateCommit, worktreeClean: false },
  });
  const insecure = createEvidenceFixture();
  insecure.directories.get(insecure.batchRoot).mode = 0o755;
  cases.push({ fixture: insecure });
  const wrongHash = createEvidenceFixture();
  wrongHash.hashes.set(join(wrongHash.batchRoot, "pre", "database.dump"), "f".repeat(64));
  cases.push({ fixture: wrongHash });
  for (const candidate of cases) {
    const result = await runCli({
      arguments_: [hostedPhase91BackupPreflightArgument],
      ...candidate,
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Hosted Phase 91 backup evidence verification failed.\n");
  }

  const missingPost = await runCli({ arguments_: [hostedPhase91BackupCompletionArgument] });
  assert.equal(missingPost.code, 1);

  const invalidArgument = await runCli({ arguments_: ["phase-81-0014"] });
  assert.deepEqual(invalidArgument, {
    code: 1,
    repositoryReads: 0,
    stderr: "Hosted Phase 91 backup arguments are invalid.\n",
    stdout: "",
  });
});

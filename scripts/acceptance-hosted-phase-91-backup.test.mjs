import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  hostedPhase91BackupArtifactDirectory,
  hostedPhase91BackupCompletionArgument,
  hostedPhase91BackupHistoricalCompletionArgument,
  hostedPhase91BackupId,
  hostedPhase91BackupPreflightArgument,
  renderHostedPhase91BackupPlan,
  runHostedPhase91BackupCli,
  verifyHostedPhase91EvidencePhase,
} from "./acceptance-hosted-phase-91-backup.mjs";
import {
  candidateCommit,
  createEvidenceFixture,
  repositoryRoot,
} from "./acceptance-hosted-phase-91-backup-fixture.mjs";

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
    readHistoricalRepositoryState: async (_root, historicalCandidateCommit) => {
      repositoryReads += 1;
      return {
        artifactRootIgnored: true,
        currentCommit: "89abcdef0123456789abcdef0123456789abcdef",
        historicalCandidateCommit,
        historicalCandidateExists: true,
        historicalCandidateIsAncestor: true,
        upstreamExact: true,
        worktreeClean: true,
      };
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
  assert.match(
    hostedPhase91BackupHistoricalCompletionArgument,
    /^--verify-historical-completion-0015-/u,
  );
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
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase91:backup:historical:verify"],
    `node scripts/acceptance-hosted-phase-91-backup.mjs ${hostedPhase91BackupHistoricalCompletionArgument}`,
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

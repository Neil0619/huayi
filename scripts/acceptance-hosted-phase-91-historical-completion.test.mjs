import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  hostedPhase91BackupHistoricalCompletionArgument,
  runHostedPhase91BackupCli,
} from "./acceptance-hosted-phase-91-backup.mjs";
import {
  candidateCommit,
  createEvidenceFixture,
  repositoryRoot,
} from "./acceptance-hosted-phase-91-backup-fixture.mjs";

const currentCommit = "89abcdef0123456789abcdef0123456789abcdef";

function historicalRepositoryState(overrides = {}) {
  return {
    artifactRootIgnored: true,
    currentCommit,
    historicalCandidateCommit: candidateCommit,
    historicalCandidateExists: true,
    historicalCandidateIsAncestor: true,
    upstreamExact: true,
    worktreeClean: true,
    ...overrides,
  };
}

test("Phase 91 historical completion verifies immutable evidence after HEAD advances", async () => {
  const fixture = createEvidenceFixture({ includePost: true });
  let historicalCandidateCommit = "";
  let currentRepositoryReads = 0;
  let stderr = "";
  let stdout = "";
  const code = await runHostedPhase91BackupCli({
    arguments_: [hostedPhase91BackupHistoricalCompletionArgument],
    evidenceIo: fixture.evidenceIo,
    readHistoricalRepositoryState: async (_root, candidate) => {
      historicalCandidateCommit = candidate;
      return historicalRepositoryState({ historicalCandidateCommit: candidate });
    },
    readRepositoryState: async () => {
      currentRepositoryReads += 1;
      throw new Error("current repository reader must not run");
    },
    repositoryRoot,
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(currentRepositoryReads, 0);
  assert.equal(historicalCandidateCommit, candidateCommit);
  assert.equal(stderr, "");
  assert.equal(stdout, "Hosted Phase 91 historical completion evidence passed.\n");
});

test("Phase 91 historical completion fails closed on inconsistent or untraceable history", async () => {
  const inconsistent = createEvidenceFixture({ includePost: true });
  const postManifestPath = join(inconsistent.batchRoot, "post", "backup-manifest.json");
  const postManifest = JSON.parse(inconsistent.files.get(postManifestPath).contents);
  postManifest.candidateCommit = "fedcba9876543210fedcba9876543210fedcba98";
  inconsistent.files.get(postManifestPath).contents = `${JSON.stringify(postManifest)}\n`;
  inconsistent.files.get(postManifestPath).size = Buffer.byteLength(
    inconsistent.files.get(postManifestPath).contents,
  );

  const outOfOrder = createEvidenceFixture({ includePost: true });
  const outOfOrderPath = join(outOfOrder.batchRoot, "post", "backup-manifest.json");
  const outOfOrderManifest = JSON.parse(outOfOrder.files.get(outOfOrderPath).contents);
  outOfOrderManifest.capturedAt = "2026-08-26T00:15:00.000Z";
  outOfOrder.files.get(outOfOrderPath).contents = `${JSON.stringify(outOfOrderManifest)}\n`;
  outOfOrder.files.get(outOfOrderPath).size = Buffer.byteLength(
    outOfOrder.files.get(outOfOrderPath).contents,
  );

  for (const candidate of [
    { fixture: inconsistent },
    { fixture: outOfOrder },
    {
      fixture: createEvidenceFixture({ includePost: true }),
      repositoryState: historicalRepositoryState({ historicalCandidateIsAncestor: false }),
    },
  ]) {
    let stderr = "";
    const code = await runHostedPhase91BackupCli({
      arguments_: [hostedPhase91BackupHistoricalCompletionArgument],
      evidenceIo: candidate.fixture.evidenceIo,
      readHistoricalRepositoryState: async () =>
        candidate.repositoryState ?? historicalRepositoryState(),
      repositoryRoot,
      writeError: (value) => {
        stderr += value;
      },
    });
    assert.equal(code, 1);
    assert.equal(stderr, "Hosted Phase 91 backup evidence verification failed.\n");
  }
});

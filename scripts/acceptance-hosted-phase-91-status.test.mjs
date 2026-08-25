import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  hostedPhase91StatusArgument,
  inspectHostedPhase91Evidence,
  runHostedPhase91StatusCli,
} from "./acceptance-hosted-phase-91-status.mjs";
import { hostedPhase91BackupArtifactDirectory } from "./acceptance-hosted-phase-91-backup.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const partialStatus = Object.freeze({
  post: { current: false, present: false, valid: false },
  pre: { current: true, present: true, valid: true },
  rebuild: { current: true, present: true, valid: true },
});

test("Phase 91 status inspects only its independent evidence identity", async () => {
  const root = "/fixed/repository";
  const batchRoot = join(root, hostedPhase91BackupArtifactDirectory);
  const verified = [];
  const status = await inspectHostedPhase91Evidence({
    evidenceIo: {
      async lstat() {
        return { isDirectory: () => true, mode: 0o700 };
      },
      async readdir(path) {
        return path === batchRoot ? ["pre", "rebuild"] : [];
      },
    },
    readRepositoryState: async () => ({
      artifactRootIgnored: true,
      candidateCommit,
      worktreeClean: true,
    }),
    repositoryRoot: root,
    verifyEvidencePhase: async (options) => {
      verified.push(options);
      return { candidateCommit };
    },
  });

  assert.deepEqual(status, partialStatus);
  assert.deepEqual(
    verified.map(({ batchRoot: actualRoot, phase }) => ({ actualRoot, phase })),
    [
      { actualRoot: batchRoot, phase: "pre" },
      { actualRoot: batchRoot, phase: "rebuild" },
    ],
  );
  assert.equal(JSON.stringify(verified).includes("phase-81"), false);
});

test("Phase 91 status CLI renders only nine fixed verdicts", async () => {
  let stderr = "";
  let stdout = "";
  const code = await runHostedPhase91StatusCli({
    arguments_: [hostedPhase91StatusArgument],
    inspectEvidence: async () => partialStatus,
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    [
      "pre_present|t",
      "pre_valid|t",
      "pre_current|t",
      "rebuild_present|t",
      "rebuild_valid|t",
      "rebuild_current|t",
      "post_present|f",
      "post_valid|f",
      "post_current|f",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(stdout, /path|time|sha|hash|commit|project|batch|secret|token/iu);
});

test("Phase 91 status rejects extra arguments and failures without reflection", async () => {
  const sensitive = "private-user@example.test";
  for (const candidate of [
    {
      arguments_: [hostedPhase91StatusArgument, sensitive],
      inspectEvidence: async () => partialStatus,
    },
    {
      arguments_: [hostedPhase91StatusArgument],
      inspectEvidence: async () => {
        throw new Error(sensitive);
      },
    },
  ]) {
    let stderr = "";
    let stdout = "";
    const code = await runHostedPhase91StatusCli({
      ...candidate,
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: (value) => {
        stdout += value;
      },
    });
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.equal(stderr, "Hosted Phase 91 backup status failed closed.\n");
    assert.doesNotMatch(stderr, new RegExp(sensitive, "u"));
  }
});

test("package exposes the fixed read-only Phase 91 status command", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase91:backup:status"],
    `node scripts/acceptance-hosted-phase-91-status.mjs ${hostedPhase91StatusArgument}`,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { inspectHostedImportantBatchHistoricalRepository } from "./acceptance-hosted-important-batch-historical-evidence.mjs";

const currentCommit = "89abcdef0123456789abcdef0123456789abcdef";
const historicalCandidateCommit = "0123456789abcdef0123456789abcdef01234567";

function successfulGitResult(arguments_) {
  if (arguments_.includes("HEAD")) return { code: 0, stdout: `${currentCommit}\n` };
  if (arguments_.includes("@{upstream}")) {
    return { code: 0, stdout: `${currentCommit}\n` };
  }
  return { code: 0, stdout: "" };
}

test("historical evidence inspection requires a clean pushed descendant HEAD", async () => {
  const calls = [];
  const result = await inspectHostedImportantBatchHistoricalRepository({
    artifactDirectory: "artifacts/fixed-important-batch",
    historicalCandidateCommit,
    repositoryRoot: "/fixed/repository",
    runGit: async (arguments_) => {
      calls.push(arguments_);
      return successfulGitResult(arguments_);
    },
  });

  assert.deepEqual(result, {
    artifactRootIgnored: true,
    currentCommit,
    historicalCandidateCommit,
    historicalCandidateExists: true,
    historicalCandidateIsAncestor: true,
    upstreamExact: true,
    worktreeClean: true,
  });
  assert.equal(
    calls.some(
      (arguments_) =>
        arguments_[0] === "cat-file" && arguments_[2] === `${historicalCandidateCommit}^{commit}`,
    ),
    true,
  );
  assert.equal(
    calls.some(
      (arguments_) =>
        arguments_[0] === "merge-base" &&
        arguments_.includes(historicalCandidateCommit) &&
        arguments_.includes("HEAD"),
    ),
    true,
  );
});

test("historical evidence inspection fails closed on untraceable repository state", async () => {
  for (const failingCommand of ["ancestor", "exists", "ignore", "status", "upstream"]) {
    await assert.rejects(
      inspectHostedImportantBatchHistoricalRepository({
        artifactDirectory: "artifacts/fixed-important-batch",
        historicalCandidateCommit,
        repositoryRoot: "/fixed/repository",
        runGit: async (arguments_) => {
          const command =
            arguments_[0] === "merge-base"
              ? "ancestor"
              : arguments_[0] === "cat-file"
                ? "exists"
                : arguments_[0] === "check-ignore"
                  ? "ignore"
                  : arguments_[0] === "status"
                    ? "status"
                    : arguments_.includes("@{upstream}")
                      ? "upstream"
                      : "head";
          if (command === failingCommand) {
            if (command === "status") return { code: 0, stdout: " M tracked\n" };
            if (command === "upstream") {
              return {
                code: 0,
                stdout: "fedcba9876543210fedcba9876543210fedcba98\n",
              };
            }
            return { code: 1, stdout: "" };
          }
          return successfulGitResult(arguments_);
        },
      }),
      /historical repository state is invalid/u,
    );
  }
});

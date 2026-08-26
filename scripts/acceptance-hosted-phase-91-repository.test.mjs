import assert from "node:assert/strict";
import test from "node:test";

import { inspectHostedPhase91HistoricalRepository } from "./acceptance-hosted-phase-91-repository.mjs";

const currentCommit = "89abcdef0123456789abcdef0123456789abcdef";
const historicalCandidateCommit = "0123456789abcdef0123456789abcdef01234567";

test("historical repository inspection requires pushed HEAD and an existing ancestor commit", async () => {
  const calls = [];
  const result = await inspectHostedPhase91HistoricalRepository({
    artifactDirectory: "artifacts/fixed-phase-91",
    historicalCandidateCommit,
    repositoryRoot: "/fixed/repository",
    runGit: async (arguments_) => {
      calls.push(arguments_);
      if (arguments_.includes("HEAD")) return { code: 0, stdout: `${currentCommit}\n` };
      if (arguments_.includes("@{upstream}")) {
        return { code: 0, stdout: `${currentCommit}\n` };
      }
      if (arguments_[0] === "status" || arguments_[0] === "check-ignore") {
        return { code: 0, stdout: "" };
      }
      return { code: 0, stdout: "" };
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

test("historical repository inspection fails closed on unpushed or untraceable history", async () => {
  for (const failingCommand of ["ancestor", "exists", "ignore", "status", "upstream"]) {
    await assert.rejects(
      inspectHostedPhase91HistoricalRepository({
        artifactDirectory: "artifacts/fixed-phase-91",
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
          if (command === "head" || command === "upstream") {
            return { code: 0, stdout: `${currentCommit}\n` };
          }
          return { code: 0, stdout: "" };
        },
      }),
      /historical repository state is invalid/u,
    );
  }
});

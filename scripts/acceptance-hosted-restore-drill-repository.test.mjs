import assert from "node:assert/strict";
import test from "node:test";

import { inspectHostedRestoreDrillRepository } from "./acceptance-hosted-restore-drill-repository.mjs";

const commit = "0123456789abcdef0123456789abcdef01234567";

test("restore repository inspection requires clean HEAD=upstream and ignored private evidence", async () => {
  const calls = [];
  const result = await inspectHostedRestoreDrillRepository({
    repositoryRoot: "/fixed/repository",
    runGit: async (arguments_) => {
      calls.push(arguments_);
      if (arguments_[0] === "status") return { code: 0, stdout: "" };
      if (arguments_[0] === "check-ignore") return { code: 0, stdout: "" };
      return { code: 0, stdout: `${commit}\n` };
    },
  });
  assert.deepEqual(result, {
    artifactRootIgnored: true,
    candidateCommit: commit,
    upstreamExact: true,
    worktreeClean: true,
  });
  assert.equal(
    calls.some((arguments_) => arguments_.includes("@{upstream}")),
    true,
  );
});

test("restore repository inspection fails closed on dirty, detached or unignored state", async () => {
  for (const failingCommand of ["head", "upstream", "status", "ignore"]) {
    await assert.rejects(
      inspectHostedRestoreDrillRepository({
        repositoryRoot: "/fixed/repository",
        runGit: async (arguments_) => {
          const command =
            arguments_[0] === "status"
              ? "status"
              : arguments_[0] === "check-ignore"
                ? "ignore"
                : arguments_.includes("@{upstream}")
                  ? "upstream"
                  : "head";
          if (command === failingCommand) {
            return command === "status"
              ? { code: 0, stdout: " M tracked\n" }
              : { code: 1, stdout: "" };
          }
          return command === "ignore"
            ? { code: 0, stdout: "" }
            : { code: 0, stdout: `${commit}\n` };
        },
      }),
    );
  }
});

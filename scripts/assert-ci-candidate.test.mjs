import assert from "node:assert/strict";
import test from "node:test";

import { assertCiCandidate } from "./assert-ci-candidate.mjs";

const candidate = "1".repeat(40);

test("CI candidate assertion accepts the exact checked-out SHA and bounded release identity", async () => {
  const calls = [];
  await assertCiCandidate({
    environment: {
      HUAYI_CI_CANDIDATE_SHA: candidate,
      HUAYI_CI_RELEASE_ID: `hosted-acceptance-${candidate}`,
    },
    runProcess: async (command, arguments_) => {
      calls.push([command, arguments_]);
      return { status: 0, stderr: "", stdout: `${candidate}\n` };
    },
  });

  assert.deepEqual(calls, [["git", ["rev-parse", "HEAD"]]]);
});

test("CI candidate assertion fails closed for missing, malformed, or mismatched inputs", async () => {
  for (const environment of [
    {},
    { HUAYI_CI_CANDIDATE_SHA: candidate, HUAYI_CI_RELEASE_ID: "bad" },
    {
      HUAYI_CI_CANDIDATE_SHA: "2".repeat(40),
      HUAYI_CI_RELEASE_ID: `hosted-acceptance-${candidate}`,
    },
  ]) {
    await assert.rejects(
      assertCiCandidate({
        environment,
        runProcess: async () => ({ status: 0, stderr: "", stdout: `${candidate}\n` }),
      }),
      /^Error: Cross-platform candidate verification failed\.$/u,
    );
  }

  await assert.rejects(
    assertCiCandidate({
      environment: {
        HUAYI_CI_CANDIDATE_SHA: candidate,
        HUAYI_CI_RELEASE_ID: `hosted-acceptance-${candidate}`,
      },
      runProcess: async () => ({ status: 0, stderr: "private", stdout: `${candidate}\n` }),
    }),
    /^Error: Cross-platform candidate verification failed\.$/u,
  );
});

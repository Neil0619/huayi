import assert from "node:assert/strict";
import test from "node:test";

import { createHostedReleaseCi } from "./acceptance-hosted-release-ci.mjs";

const candidateSha = "e".repeat(40);
const releaseId = `hosted-acceptance-${candidateSha}`;
const title = `Cross-platform quality / ${releaseId} / ${candidateSha}`;

function result(stdout = "") {
  return { status: 0, stderr: "", stdout };
}

test("CI adapter dispatches one exact candidate and binds only its unique release run", async () => {
  const calls = [];
  let listCount = 0;
  const ci = createHostedReleaseCi({
    environment: { HOME: "/Users/test", PATH: "/bin" },
    runProcess: async (command, arguments_, options) => {
      calls.push({ arguments_, command, options });
      if (arguments_[0] === "workflow") return result();
      listCount += 1;
      return result(
        JSON.stringify(
          listCount === 1
            ? []
            : [
                {
                  conclusion: "",
                  createdAt: "2026-09-02T00:00:00Z",
                  databaseId: 12345,
                  displayTitle: title,
                  headSha: candidateSha,
                  status: "queued",
                  url: "https://github.com/Neil0619/huayi/actions/runs/12345",
                },
              ],
        ),
      );
    },
    sleep: async () => undefined,
  });

  assert.equal(await ci.find({ candidateSha, releaseId }), undefined);
  await ci.dispatch({ candidateSha, releaseId });
  assert.deepEqual(await ci.find({ candidateSha, releaseId }), {
    conclusion: null,
    id: 12345,
    status: "queued",
  });
  const dispatch = calls.find(({ arguments_ }) => arguments_[0] === "workflow");
  assert.deepEqual(dispatch.arguments_, [
    "workflow",
    "run",
    "cross-platform-quality.yml",
    "--ref",
    "codex/settings-configuration",
    "-f",
    `candidate_sha=${candidateSha}`,
    "-f",
    `release_id=${releaseId}`,
  ]);
});

test("CI adapter waits for both exact platform jobs and fails closed on a failed job", async () => {
  let failed = false;
  const ci = createHostedReleaseCi({
    runProcess: async () =>
      result(
        JSON.stringify({
          conclusion: failed ? "failure" : "success",
          databaseId: 12345,
          displayTitle: title,
          headSha: candidateSha,
          jobs: [
            {
              conclusion: failed ? "failure" : "success",
              name: "macos-quality",
              status: "completed",
            },
            { conclusion: "success", name: "windows-quality", status: "completed" },
          ],
          status: "completed",
          url: "https://github.com/Neil0619/huayi/actions/runs/12345",
        }),
      ),
    sleep: async () => undefined,
  });

  assert.deepEqual(await ci.wait({ candidateSha, releaseId, runId: 12345 }), {
    conclusion: "success",
    id: 12345,
    status: "completed",
  });
  failed = true;
  await assert.rejects(
    ci.wait({ candidateSha, releaseId, runId: 12345 }),
    /^Error: Hosted acceptance release CI failed closed\.$/u,
  );
});

test("CI adapter rejects duplicate release runs instead of guessing", async () => {
  const item = {
    conclusion: "success",
    createdAt: "2026-09-02T00:00:00Z",
    databaseId: 12345,
    displayTitle: title,
    headSha: candidateSha,
    status: "completed",
    url: "https://github.com/Neil0619/huayi/actions/runs/12345",
  };
  const ci = createHostedReleaseCi({
    runProcess: async () => result(JSON.stringify([item, { ...item, databaseId: 12346 }])),
  });
  await assert.rejects(
    ci.find({ candidateSha, releaseId }),
    /^Error: Hosted acceptance release CI failed closed\.$/u,
  );
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertProductionCi,
  createProductionAttemptRecorder,
  withProductionReleaseLock,
} from "./production-release-evidence.mjs";

const sha = "a".repeat(40);
function ciFixture() {
  return {
    run: {
      id: 123,
      head_sha: sha,
      event: "workflow_dispatch",
      path: ".github/workflows/cross-platform-quality.yml",
      display_title: `Cross-platform quality / production-${sha} / ${sha}`,
      status: "completed",
      conclusion: "success",
    },
    jobs: {
      total_count: 2,
      jobs: ["macos", "windows"].map((platform) => ({
        name: `${platform}-quality`,
        status: "completed",
        conclusion: "success",
        steps: [
          { name: "Verify exact candidate", conclusion: "success" },
          { name: `Run pnpm verify:${platform}`, conclusion: "success" },
        ],
      })),
    },
  };
}

test("production CI requires the exact candidate and both actual native verification steps", () => {
  assert.deepEqual(assertProductionCi(sha, 123, ciFixture()), {
    runId: 123,
    candidateSha: sha,
    passed: true,
  });
  for (const mutate of [
    (v) => {
      v.run.head_sha = "b".repeat(40);
    },
    (v) => {
      v.run.display_title = "acceptance";
    },
    (v) => {
      v.run.event = "pull_request";
    },
    (v) => {
      v.jobs.total_count = 1;
    },
    (v) => {
      v.jobs.jobs[1].conclusion = "failure";
    },
    (v) => {
      v.jobs.jobs[1].steps[1].conclusion = "skipped";
    },
  ]) {
    const value = ciFixture();
    mutate(value);
    assert.throws(() => assertProductionCi(sha, 123, value), {
      message: "Exact production candidate CI evidence is incomplete.",
    });
  }
});

test("durable attempt records refuse replay across recorder instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seen-said-production-journal-"));
  try {
    const attempt = {
      candidateSha: sha,
      attemptId: "b".repeat(32),
      releaseId: `production-${sha}`,
      kind: "api",
      projectId: "prj_NePC3jZHC6UBARQjRzImNcAmbrdu",
    };
    const record = createProductionAttemptRecorder(directory);
    await record(attempt);
    const saved = JSON.parse(await readFile(join(directory, `production-${sha}-api.json`), "utf8"));
    assert.equal(saved.status, "outcome-unknown-until-readback");
    assert.equal(saved.attemptId, attempt.attemptId);
    await assert.rejects(createProductionAttemptRecorder(directory)(attempt));
    await assert.rejects(record({ ...attempt, kind: "../unsafe" }));
    await assert.rejects(record({ ...attempt, apiKey: "private-secret" }));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("one production lock serializes writers across candidates and releases after a failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seen-said-production-lock-"));
  try {
    await withProductionReleaseLock(directory, async () => {
      await assert.rejects(
        withProductionReleaseLock(directory, async () => assert.fail("second writer")),
      );
    });
    await assert.rejects(
      withProductionReleaseLock(directory, async () => {
        throw new Error("failure");
      }),
    );
    assert.equal(await withProductionReleaseLock(directory, async () => "ready"), "ready");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

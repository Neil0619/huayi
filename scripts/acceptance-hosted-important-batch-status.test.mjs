import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedImportantBatchStatusArgument,
  renderHostedImportantBatchStatus,
  runHostedImportantBatchStatusCli,
} from "./acceptance-hosted-important-batch-status.mjs";

const partialStatus = Object.freeze({
  post: { current: false, present: false, valid: false },
  pre: { current: false, present: false, valid: false },
  rebuild: { current: false, present: true, valid: true },
});

test("status CLI renders only nine fixed body-free current-candidate verdicts", async () => {
  let calls = 0;
  let stdout = "";
  let stderr = "";
  const code = await runHostedImportantBatchStatusCli({
    arguments_: [hostedImportantBatchStatusArgument],
    inspectEvidence: async () => {
      calls += 1;
      return partialStatus;
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(calls, 1);
  assert.equal(stderr, "");
  assert.equal(stdout, renderHostedImportantBatchStatus(partialStatus));
  assert.equal(
    stdout,
    [
      "pre_present|f",
      "pre_valid|f",
      "pre_current|f",
      "rebuild_present|t",
      "rebuild_valid|t",
      "rebuild_current|f",
      "post_present|f",
      "post_valid|f",
      "post_current|f",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(
    stdout,
    /path|time|sha|hash|commit|project|batch|identity|dump|byte|email|secret|token/iu,
  );
});

test("status CLI rejects arguments, invalid verdicts, and failures without reflection", async () => {
  const secret = "private-user@example.test";
  for (const candidate of [
    {
      arguments_: [hostedImportantBatchStatusArgument, secret],
      inspectEvidence: async () => partialStatus,
    },
    {
      arguments_: [hostedImportantBatchStatusArgument],
      inspectEvidence: async () => ({ ...partialStatus, pre: { present: true } }),
    },
    {
      arguments_: [hostedImportantBatchStatusArgument],
      inspectEvidence: async () => {
        throw new Error(secret);
      },
    },
  ]) {
    let stdout = "";
    let stderr = "";
    const code = await runHostedImportantBatchStatusCli({
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
    assert.equal(stderr, "Hosted important-batch backup status failed closed.\n");
    assert.doesNotMatch(stderr, new RegExp(secret, "u"));
  }
});

test("package exposes the fixed read-only backup status command", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:status"],
    `node scripts/acceptance-hosted-important-batch-status.mjs ${hostedImportantBatchStatusArgument}`,
  );
});

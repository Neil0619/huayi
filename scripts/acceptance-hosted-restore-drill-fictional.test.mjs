import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedRestoreFictionalConfirmation,
  runHostedRestoreFictionalCli,
} from "./acceptance-hosted-restore-drill-fictional.mjs";

function capture() {
  let stderr = "";
  let stdout = "";
  return {
    read: () => ({ stderr, stdout }),
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  };
}

test("fictional CLI accepts only its fixed local confirmation and emits fixed output", async () => {
  for (const [arguments_, expectedCode, runs] of [
    [[], 1, 0],
    [["--confirm-hosted-production-restore-drill"], 1, 0],
    [[hostedRestoreFictionalConfirmation, "extra"], 1, 0],
    [[hostedRestoreFictionalConfirmation], 0, 1],
  ]) {
    let actualRuns = 0;
    const output = capture();
    const code = await runHostedRestoreFictionalCli({
      arguments_,
      runFictionalArchive: async () => {
        actualRuns += 1;
      },
      ...output,
    });
    assert.equal(code, expectedCode);
    assert.equal(actualRuns, runs);
    assert.deepEqual(
      output.read(),
      expectedCode === 0
        ? {
            stderr: "",
            stdout: "Hosted restore-drill fictional PG17 archive verification passed.\n",
          }
        : {
            stderr: "Hosted restore-drill fictional PG17 archive verification failed closed.\n",
            stdout: "",
          },
    );
  }
});

test("package exposes the fictional verifier separately from production restore stages", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:restore:fictional:verify"],
    `node scripts/acceptance-hosted-restore-drill-fictional.mjs ${hostedRestoreFictionalConfirmation}`,
  );
});

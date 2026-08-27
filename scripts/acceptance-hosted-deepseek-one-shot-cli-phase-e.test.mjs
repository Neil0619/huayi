import assert from "node:assert/strict";
import test from "node:test";

import {
  hostedDeepSeekOneShotConfirmation,
  runHostedDeepSeekOneShotCli,
} from "./acceptance-hosted-deepseek-one-shot.mjs";
import { candidateCommit } from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";

test("Phase E CLI keeps plan zero-I/O and exposes fixed status", async () => {
  let created = 0;
  let stdout = "";
  assert.equal(
    await runHostedDeepSeekOneShotCli({
      arguments_: ["plan"],
      createProductionExecutor: async () => {
        created += 1;
      },
      writeOutput: (value) => {
        stdout += value;
      },
    }),
    0,
  );
  assert.equal(created, 0);
  assert.match(stdout, /zero filesystem \/ zero Git \/ zero network \/ zero Hosted write/u);

  stdout = "";
  assert.equal(
    await runHostedDeepSeekOneShotCli({
      arguments_: ["status"],
      createProductionExecutor: async () => ({
        status: async () => ({ state: "cleanup-pending" }),
      }),
      writeOutput: (value) => {
        stdout += value;
      },
    }),
    0,
  );
  assert.equal(stdout, "Hosted Cloud Web DeepSeek one-shot status: cleanup-pending.\n");
});

test("Phase E CLI execute requires the exact confirmation, commit, and reservation cap", async () => {
  const observed = [];
  let stdout = "";
  const code = await runHostedDeepSeekOneShotCli({
    arguments_: ["execute", candidateCommit, "500", hostedDeepSeekOneShotConfirmation],
    createProductionExecutor: async () => ({
      execute: async (value) => {
        observed.push(value);
        return { killSwitchRestored: true, outcome: "accepted" };
      },
    }),
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(observed, [
    {
      candidateCommit,
      confirmation: hostedDeepSeekOneShotConfirmation,
      maximumReservationMicroUsd: 500,
    },
  ]);
  assert.equal(
    stdout,
    "Hosted Cloud Web DeepSeek one-shot accepted; kill switch restored; Web session closed.\n",
  );
});

test("Phase E CLI recover accepts no opaque identity and renders only fixed output", async () => {
  let recovered = 0;
  let stdout = "";
  assert.equal(
    await runHostedDeepSeekOneShotCli({
      arguments_: ["recover"],
      createProductionExecutor: async () => ({
        recover: async () => {
          recovered += 1;
          return { killSwitchRestored: true, outcome: "restored" };
        },
      }),
      writeOutput: (value) => {
        stdout += value;
      },
    }),
    0,
  );
  assert.equal(recovered, 1);
  assert.equal(
    stdout,
    "Hosted Cloud Web DeepSeek one-shot recovery completed; kill switch restored.\n",
  );

  for (const arguments_ of [
    ["recover", "opaque-operation-id"],
    ["status", "opaque-id"],
  ]) {
    recovered = 0;
    stdout = "";
    let stderr = "";
    assert.equal(
      await runHostedDeepSeekOneShotCli({
        arguments_,
        createProductionExecutor: async () => {
          throw new Error("must not create");
        },
        writeError: (value) => {
          stderr += value;
        },
        writeOutput: (value) => {
          stdout += value;
        },
      }),
      1,
    );
    assert.equal(stdout, "");
    assert.equal(stderr, "Hosted Cloud Web DeepSeek one-shot failed closed.\n");
  }
});

test("Phase E CLI rejects malformed executor outcomes instead of printing false success", async () => {
  for (const [arguments_, executor] of [
    [
      ["execute", candidateCommit, "500", hostedDeepSeekOneShotConfirmation],
      { execute: async () => undefined },
    ],
    [
      ["execute", candidateCommit, "500", hostedDeepSeekOneShotConfirmation],
      { execute: async () => ({ killSwitchRestored: false, outcome: "accepted" }) },
    ],
    [["recover"], { recover: async () => ({ killSwitchRestored: true, outcome: "failed" }) }],
    [
      ["recover"],
      {
        recover: async () => ({
          extra: "private-value",
          killSwitchRestored: true,
          outcome: "restored",
        }),
      },
    ],
  ]) {
    let stdout = "";
    let stderr = "";
    assert.equal(
      await runHostedDeepSeekOneShotCli({
        arguments_,
        createProductionExecutor: async () => executor,
        writeError: (value) => {
          stderr += value;
        },
        writeOutput: (value) => {
          stdout += value;
        },
      }),
      1,
    );
    assert.equal(stdout, "");
    assert.equal(stderr, "Hosted Cloud Web DeepSeek one-shot failed closed.\n");
  }
});

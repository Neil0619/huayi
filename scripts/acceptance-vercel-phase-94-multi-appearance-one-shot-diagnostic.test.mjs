import assert from "node:assert/strict";
import { test } from "node:test";

import {
  phase94MultiAppearanceVercelDiagnosticArgument,
  phase94MultiAppearanceVercelDiagnosticFieldNames,
  runPhase94MultiAppearanceVercelDiagnosticCli,
} from "./acceptance-vercel-phase-94-multi-appearance-one-shot-diagnostic.mjs";
import {
  candidate,
  gitState,
  phase93FreshCompleteState,
  phase94BaselineSnapshot,
  token,
  tracedPhase94Snapshot,
} from "./acceptance-vercel-phase-94-multi-appearance-test-support.mjs";

test("Phase 94 diagnostic is read-only, sanitized, and separates every predicate", async () => {
  let writes = 0;
  let stdout = "";
  const code = await runPhase94MultiAppearanceVercelDiagnosticCli({
    arguments_: [phase94MultiAppearanceVercelDiagnosticArgument],
    environment: {},
    fetch_: async () => ({ status: 200 }),
    historicalStateStore: { read: async () => phase93FreshCompleteState() },
    inspectGit_: async () => gitState(),
    readCredential: async () => token,
    readSnapshot_: tracedPhase94Snapshot,
    stateStore: { read: async () => undefined, write: async () => (writes += 1) },
    writeOutput: (value) => (stdout += value),
  });
  assert.equal(code, 0);
  assert.equal(writes, 0);
  assert.deepEqual(
    stdout
      .trimEnd()
      .split("\n")
      .map((line) => line.split("|")[0]),
    phase94MultiAppearanceVercelDiagnosticFieldNames,
  );
  const lines = new Set(stdout.trimEnd().split("\n"));
  for (const line of [
    "historical_state_readable|t",
    "historical_completion_exact|t",
    "state_readable|t",
    "state_absent|t",
    "candidate_git_exact|t",
    "api_baseline_count_exact|t",
    "api_latest_identity_exact|t",
    "api_zero_in_flight|t",
    "web_baseline_count_exact|t",
    "web_latest_identity_exact|t",
    "web_zero_in_flight|t",
    "history_contract_exact|t",
    "request_count|5",
    "contract_exact|t",
    "state_write_attempted|f",
  ]) {
    assert.equal(lines.has(line), true, `missing diagnostic line: ${line}`);
  }
  assert.doesNotMatch(stdout, new RegExp(`${token}|dpl_|${candidate}`, "u"));
});

test("Phase 94 diagnostic identifies independent history and state drift without reflection", async () => {
  let stdout = "";
  const code = await runPhase94MultiAppearanceVercelDiagnosticCli({
    arguments_: [phase94MultiAppearanceVercelDiagnosticArgument],
    environment: {},
    fetch_: async () => ({ status: 200 }),
    historicalStateStore: { read: async () => phase93FreshCompleteState() },
    inspectGit_: async () => gitState(),
    readCredential: async () => token,
    readSnapshot_: async ({ fetch_ }) => {
      for (let index = 0; index < 5; index += 1) await fetch_();
      return {
        ...phase94BaselineSnapshot(),
        web: phase94BaselineSnapshot().web.slice(1),
      };
    },
    stateStore: { read: async () => ({ phase: "unexpected" }) },
    writeOutput: (value) => (stdout += value),
  });
  assert.equal(code, 1);
  assert.match(stdout, /^historical_completion_exact\|t$/mu);
  assert.match(stdout, /^state_absent\|f$/mu);
  assert.match(stdout, /^web_baseline_count_exact\|f$/mu);
  assert.match(stdout, /^web_latest_identity_exact\|f$/mu);
  assert.match(stdout, /^history_contract_exact\|f$/mu);
  assert.match(stdout, /^contract_exact\|f$/mu);
  assert.doesNotMatch(stdout, new RegExp(`${token}|dpl_|${candidate}|unexpected`, "u"));
});

test("Phase 94 diagnostic separates candidate drift from exact history and absent state", async () => {
  let stdout = "";
  const code = await runPhase94MultiAppearanceVercelDiagnosticCli({
    arguments_: [phase94MultiAppearanceVercelDiagnosticArgument],
    environment: {},
    fetch_: async () => ({ status: 200 }),
    historicalStateStore: { read: async () => phase93FreshCompleteState() },
    inspectGit_: async () => gitState({ upstreamCommit: "f".repeat(40) }),
    readCredential: async () => token,
    readSnapshot_: tracedPhase94Snapshot,
    stateStore: { read: async () => undefined },
    writeOutput: (value) => (stdout += value),
  });
  assert.equal(code, 1);
  assert.match(stdout, /^historical_completion_exact\|t$/mu);
  assert.match(stdout, /^state_absent\|t$/mu);
  assert.match(stdout, /^candidate_git_exact\|f$/mu);
  assert.match(stdout, /^history_contract_exact\|t$/mu);
  assert.match(stdout, /^contract_exact\|f$/mu);
  assert.doesNotMatch(stdout, new RegExp(`${token}|dpl_|${candidate}`, "u"));
});

test("Phase 94 diagnostic separates historical completion drift from current predicates", async () => {
  let stdout = "";
  const historical = phase93FreshCompleteState();
  const code = await runPhase94MultiAppearanceVercelDiagnosticCli({
    arguments_: [phase94MultiAppearanceVercelDiagnosticArgument],
    environment: {},
    fetch_: async () => ({ status: 200 }),
    historicalStateStore: {
      read: async () => ({ ...historical, webDisarmCommit: "f".repeat(40) }),
    },
    inspectGit_: async () => gitState(),
    readCredential: async () => token,
    readSnapshot_: tracedPhase94Snapshot,
    stateStore: { read: async () => undefined },
    writeOutput: (value) => (stdout += value),
  });
  assert.equal(code, 1);
  assert.match(stdout, /^historical_state_readable\|t$/mu);
  assert.match(stdout, /^historical_completion_exact\|f$/mu);
  assert.match(stdout, /^state_absent\|t$/mu);
  assert.match(stdout, /^candidate_git_exact\|t$/mu);
  assert.match(stdout, /^history_contract_exact\|t$/mu);
  assert.match(stdout, /^contract_exact\|f$/mu);
  assert.doesNotMatch(stdout, new RegExp(`${token}|dpl_|${candidate}`, "u"));
});

test("Phase 94 rejects legacy plaintext token input before credential or remote work", async () => {
  let credentialReads = 0;
  let remoteReads = 0;
  let stdout = "";
  const code = await runPhase94MultiAppearanceVercelDiagnosticCli({
    arguments_: [phase94MultiAppearanceVercelDiagnosticArgument],
    environment: { VERCEL_TOKEN: token },
    historicalStateStore: { read: async () => phase93FreshCompleteState() },
    inspectGit_: async () => gitState(),
    readCredential: async () => {
      credentialReads += 1;
      return token;
    },
    readSnapshot_: async () => {
      remoteReads += 1;
      return phase94BaselineSnapshot();
    },
    stateStore: { read: async () => undefined },
    writeOutput: (value) => (stdout += value),
  });
  assert.equal(code, 1);
  assert.equal(credentialReads, 0);
  assert.equal(remoteReads, 0);
  assert.match(stdout, /^token_format_exact\|f$/mu);
  assert.match(stdout, /^request_count\|0$/mu);
  assert.doesNotMatch(stdout, new RegExp(token, "u"));
});

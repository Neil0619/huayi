import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyHostedMigration0014DryRunTranscript,
  hasExactHostedMigration0014DryRunTranscript,
} from "./acceptance-hosted-migration-0014-dry-run.mjs";

const lines = [
  "DRY RUN: migrations will *not* be pushed to the database.",
  "Connecting to remote database...",
  "Would push these migrations:",
  " • 20260824010000_password_signup_otp_resend.sql",
  "Finished supabase db push.",
];

function channel(...indexes) {
  return indexes.length === 0 ? "" : `${indexes.map((index) => lines[index]).join("\n")}\n`;
}

test("0014 transcript accepts exact allowlisted lines split between child channels", () => {
  for (const result of [
    { stderr: channel(0, 1), stdout: channel(2, 3, 4) },
    { stderr: channel(1, 3), stdout: channel(0, 2, 4) },
    { stderr: channel(0, 2, 4), stdout: channel(1, 3) },
  ]) {
    assert.deepEqual(classifyHostedMigration0014DryRunTranscript(result), {
      channelRelativeOrderExact: true,
      lineMultisetExact: true,
      stderrLinesAllowlisted: true,
      stdoutLinesAllowlisted: true,
      transcriptExact: true,
    });
    assert.equal(hasExactHostedMigration0014DryRunTranscript(result), true);
  }
});

test("0014 transcript rejects fragments, duplicates, reordering, ANSI, and extra lines", () => {
  const invalidResults = [
    { stderr: channel(0, 1), stdout: `${lines[2].slice(0, 8)}\n${channel(3, 4)}` },
    { stderr: channel(0, 1, 2), stdout: channel(2, 3, 4) },
    { stderr: channel(1, 0), stdout: channel(2, 3, 4) },
    { stderr: channel(0, 1), stdout: `\u001b[32m${channel(2, 3, 4)}` },
    { stderr: channel(0, 1), stdout: `${channel(2, 3, 4)}private noise\n` },
    { stderr: channel(0, 1), stdout: channel(2, 3) },
    { stderr: channel(0, 1), stdout: `${lines[2]}\n${lines[3]}` },
    { stderr: channel(0, 1), stdout: `${channel(2, 3, 4)}\n` },
    { stderr: channel(0, 1).replaceAll("\n", "\r\n"), stdout: channel(2, 3, 4) },
    {
      stderr: channel(0, 1),
      stdout: channel(2, 3, 4).replace("20260824010000", "20260824020000"),
    },
    { stderr: channel(0, 1, 2), stdout: `${lines[3].slice(2)}\n${channel(4)}` },
  ];

  for (const result of invalidResults) {
    assert.equal(hasExactHostedMigration0014DryRunTranscript(result), false);
  }
});

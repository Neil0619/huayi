import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import * as verifierModule from "./verify-ephemeral-session.mjs";
import {
  createSmokeRequests,
  findNewFiles,
  listRelativeFiles,
  resolveExecutable,
} from "./verify-ephemeral-session.mjs";

test("confirmed shutdown failures are snapshotted before being reported", async () => {
  const events = [];
  const protocolError = new Error("invalid native message");
  const client = {
    shutdownComplete: true,
    async close() {
      events.push("close");
      throw protocolError;
    },
  };

  const outcome = await verifierModule.closeHostAndSnapshotSessions({
    client,
    removeWorkingDirectory: async () => events.push("cleanup"),
    snapshotSessions: async () => {
      events.push("snapshot");
      return ["after.jsonl"];
    },
  });

  assert.deepEqual(events, ["close", "cleanup", "snapshot"]);
  assert.deepEqual(outcome.afterSessions, ["after.jsonl"]);
  assert.equal(outcome.closeError, protocolError);
});

test("incomplete shutdown cleans up but never snapshots sessions", async () => {
  const events = [];
  const shutdownError = new Error("shutdown incomplete");
  const client = {
    shutdownComplete: false,
    async close() {
      events.push("close");
      throw shutdownError;
    },
  };

  await assert.rejects(
    verifierModule.closeHostAndSnapshotSessions({
      client,
      removeWorkingDirectory: async () => events.push("cleanup"),
      snapshotSessions: async () => events.push("snapshot"),
    }),
    (error) => error === shutdownError,
  );
  assert.deepEqual(events, ["close", "cleanup"]);
});

test("session snapshots compare filenames without reading contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "huayi-session-test-"));
  try {
    await mkdir(join(root, "2026", "07"), { recursive: true });
    await writeFile(join(root, "2026", "07", "before.jsonl"), "secret", "utf8");
    const before = await listRelativeFiles(root);
    await writeFile(join(root, "2026", "07", "after.jsonl"), "do-not-read", "utf8");
    const after = await listRelativeFiles(root);

    assert.deepEqual(findNewFiles(before, after), [join("2026", "07", "after.jsonl")]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Codex resolution scans PATH without a shell", async () => {
  const root = await mkdtemp(join(tmpdir(), "huayi-resolve-test-"));
  try {
    const executable = join(root, "codex");
    await writeFile(executable, "#!/bin/sh\n", "utf8");
    await chmod(executable, 0o755);
    assert.equal(await resolveExecutable(undefined, root), await realpath(executable));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("smoke requests cover the four MVP cases", () => {
  const requests = createSmokeRequests(1);
  assert.deepEqual(
    requests.map((request) => [request.selection, request.action, request.selectionKind]),
    [
      ["investigation", "translate", "word"],
      ["sustained heatwave", "explain", "phrase"],
      [
        "He said the investigation was in the early stages and urged anyone with information to come forward.",
        "explain",
        "sentence",
      ],
      [
        "The investigation remains in its early stages.\nOfficials asked witnesses to come forward with information.",
        "translate",
        "paragraph",
      ],
    ],
  );
});

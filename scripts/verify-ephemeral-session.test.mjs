import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import * as verifierModule from "./verify-ephemeral-session.mjs";
import {
  createSmokeRequests,
  findNewFiles,
  formatSmokeTimings,
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

test("smoke requests cover the exact lexical regression and passage matrix", () => {
  const requests = createSmokeRequests(2);
  assert.deepEqual(requests, [
    {
      action: "translate",
      context: "He said the investigation was in its early stages.",
      requestId: "smoke-investigation",
      schemaVersion: 2,
      selection: "investigation",
      selectionKind: "word",
      sentenceContext: "He said the investigation was in its early stages.",
      targetLanguage: "zh-CN",
      type: "analyze",
    },
    {
      action: "translate",
      context: "The recovery remained sustained throughout the difficult winter.",
      requestId: "smoke-sustained",
      schemaVersion: 2,
      selection: "sustained",
      selectionKind: "word",
      sentenceContext: "The recovery remained sustained throughout the difficult winter.",
      targetLanguage: "zh-CN",
      type: "analyze",
    },
    {
      action: "explain",
      context: "The victims received immediate support from local volunteers.",
      requestId: "smoke-victims",
      schemaVersion: 2,
      selection: "victims",
      selectionKind: "word",
      sentenceContext: "The victims received immediate support from local volunteers.",
      targetLanguage: "zh-CN",
      type: "analyze",
    },
    {
      action: "explain",
      context: "Managers are accountable for the safety of their teams.",
      requestId: "smoke-accountable",
      schemaVersion: 2,
      selection: "accountable",
      selectionKind: "word",
      sentenceContext: "Managers are accountable for the safety of their teams.",
      targetLanguage: "zh-CN",
      type: "analyze",
    },
    {
      action: "translate",
      context: "Four students presented their findings to the class.",
      requestId: "smoke-four",
      schemaVersion: 2,
      selection: "Four",
      selectionKind: "word",
      sentenceContext: "Four students presented their findings to the class.",
      targetLanguage: "zh-CN",
      type: "analyze",
    },
    {
      action: "explain",
      context: "The region experienced a sustained heatwave throughout July.",
      requestId: "smoke-sustained-heatwave",
      schemaVersion: 2,
      selection: "sustained heatwave",
      selectionKind: "phrase",
      sentenceContext: "The region experienced a sustained heatwave throughout July.",
      targetLanguage: "zh-CN",
      type: "analyze",
    },
    {
      action: "explain",
      context:
        "He said the investigation was in the early stages and urged anyone with information to come forward.",
      requestId: "smoke-sentence",
      schemaVersion: 2,
      selection:
        "He said the investigation was in the early stages and urged anyone with information to come forward.",
      selectionKind: "sentence",
      sentenceContext: null,
      targetLanguage: "zh-CN",
      type: "analyze",
    },
    {
      action: "translate",
      context:
        "The investigation remains in its early stages.\nOfficials asked witnesses to come forward with information.",
      requestId: "smoke-paragraph",
      schemaVersion: 2,
      selection:
        "The investigation remains in its early stages.\nOfficials asked witnesses to come forward with information.",
      selectionKind: "paragraph",
      sentenceContext: null,
      targetLanguage: "zh-CN",
      type: "analyze",
    },
  ]);
});

test("smoke timing output uses only exact integer timing labels", () => {
  const output = formatSmokeTimings({
    firstUpdateAt: 1_150,
    fullResultAt: 1_700,
    startedAt: 1_000,
  });

  assert.equal(output, "click-to-first-delta: 150 ms\nclick-to-full-result: 700 ms\n");
  assert.equal(output.includes("secret model output"), false);
});

test("smoke sequence sends payload-free warmup first and emits only safe timings", async () => {
  assert.equal(typeof verifierModule.runSmokeSequence, "function");
  assert.equal(typeof verifierModule.formatWarmupTiming, "function");
  if (
    typeof verifierModule.runSmokeSequence !== "function" ||
    typeof verifierModule.formatWarmupTiming !== "function"
  ) {
    return;
  }

  const requests = createSmokeRequests(2).slice(0, 1);
  const sent = [];
  let output = "";
  const result = {
    collocations: [],
    contextualMeaningZh: "secret model output",
    partOfSpeech: "noun",
    selectionKind: "word",
    similarTerms: [],
    sourceText: "investigation",
    type: "translate-lexical",
  };
  const client = {
    async request(request, expectedType, _timeoutMs, options) {
      sent.push([request, expectedType]);
      if (request.type === "analyze") {
        options?.validateTerminal({ requestId: request.requestId, result, type: "result" });
        return {
          firstUpdateAt: 1_250,
          fullResultAt: 1_300,
          requestId: request.requestId,
          type: "result",
          updateCount: 2,
        };
      }
      return { requestId: request.requestId, type: expectedType };
    },
  };
  const identitySchema = { parse: (value) => value };
  const protocol = {
    SCHEMA_VERSION: 2,
    analysisResultSchema: identitySchema,
    analyzeRequestSchema: identitySchema,
    healthRequestSchema: identitySchema,
    warmupRequestSchema: identitySchema,
  };
  const clock = [1_150, 1_200];

  await verifierModule.runSmokeSequence({
    client,
    now: () => clock.shift() ?? 1_200,
    protocol,
    requests,
    warmupStartedAt: 1_000,
    writeOutput: (value) => {
      output += value;
    },
  });

  assert.deepEqual(
    sent.map(([request, expectedType]) => [
      request.type,
      expectedType,
      Object.keys(request).sort(),
    ]),
    [
      ["warmup", "warmup-ready", ["requestId", "schemaVersion", "type"]],
      ["health", "health-result", ["requestId", "schemaVersion", "type"]],
      [
        "analyze",
        "result",
        [
          "action",
          "context",
          "requestId",
          "schemaVersion",
          "selection",
          "selectionKind",
          "sentenceContext",
          "targetLanguage",
          "type",
        ],
      ],
    ],
  );
  assert.equal(
    output,
    "cold warmup: 150 ms\n" + "click-to-first-delta: 50 ms\n" + "click-to-full-result: 100 ms\n",
  );
  assert.equal(output.includes("secret model output"), false);
});

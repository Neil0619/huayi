import { describe, expect, it } from "vitest";
import { analysisUpdateSchema } from "./learning-domain-exports.js";
import {
  structuredAnalysisRecordSchema,
  sentenceExplanationV2ResultSchema,
  assembleSentenceStructure,
} from "@huayi/learning-domain";
import { quotaSummarySchema } from "./common-contracts.js";
import { analysisEventSchema } from "./analysis-contracts.js";
import {
  extensionQueryEventSchema,
  extensionQueryGenerationSchema,
} from "./extension-learning-contracts.js";
import {
  learningTaskCommandSchema,
  learningTaskEventSchema,
  learningTaskSnapshotSchema,
} from "./learning-tasks.js";
import { createLearningTaskSseDecoder } from "./learning-task-sse-decoder.js";
import {
  analysisEventReadSchema,
  extensionQueryEventReadSchema,
  extensionQueryGenerationReadSchema,
  projectAnalysisEventForLegacy,
  projectQueryEventForLegacy,
  projectQueryGenerationForLegacy,
} from "./structured-teaching-events.js";
import {
  learningTaskCommandReadSchema,
  learningTaskEventReadSchema,
  learningTaskSnapshotReadSchema,
  projectTaskEventForLegacy,
  projectTaskSnapshotForLegacy,
} from "./structured-learning-tasks.js";

const id = "00000000-0000-4000-8000-000000000001";
const now = "2026-09-12T10:00:00Z";
const quota = quotaSummarySchema.parse({
  limitMicroUsd: 100,
  usedMicroUsd: 20,
  reservedMicroUsd: 0,
  availableMicroUsd: 80,
  percentUsed: 20,
  warning: "available",
  periodStart: "2026-09-01T00:00:00Z",
  periodEnd: "2026-10-01T00:00:00Z",
});
const unit = {
  analysisUnitId: "u1",
  ordinal: 0,
  sourceText: "Go.",
  sentenceStructure: assembleSentenceStructure("Go.", {
    kind: "sentence",
    coreClauses: [
      { fragments: [{ text: "Go", occurrence: 1 }], explanationZh: "祈使句要求行动。" },
    ],
    modifiers: [],
  }),
};
function record() {
  return structuredAnalysisRecordSchema.parse({
    id,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    archivedAt: null,
    reviewState: "pendingReview",
    source: { type: "manual" },
    sourceText: "Go.",
    sourceNormalizedHash: "a".repeat(64),
    selectionKind: "sentence",
    candidates: [],
    modelMetadata: {
      provider: "deepseek",
      model: "test",
      promptVersion: "structured-v1",
      schemaVersion: 3,
    },
    result: {
      type: "sentence-passage-analysis-v3",
      recommendations: [],
      overall: { translationZh: "走吧。", understandingZh: "要求采取行动。" },
      sentences: [
        {
          ...unit,
          candidateIds: [],
          grammar: [],
          expressions: [],
          languageNotes: [],
          translationZh: "走吧。",
        },
      ],
    },
  });
}
function queryResult() {
  return sentenceExplanationV2ResultSchema.parse({
    type: "explain-sentence-v2",
    selectionKind: "sentence",
    requestId: id,
    sourceText: "Go.",
    translationZh: "走吧。",
    contextRole: "要求采取行动。",
    keyExpressions: [{ text: "Go", meaningZh: "走" }],
    sentenceStructures: [unit],
  });
}

describe("durable structured teaching transport", () => {
  it("keeps the v2 task envelope and saves explicit generation intent for all affected commands", () => {
    for (const command of [
      {
        version: 2,
        kind: "analysis",
        input: {
          selectionKind: "sentence",
          source: { type: "manual" },
          sourceText: "Go.",
          outputContract: "structured-teaching-v1",
        },
      },
      {
        version: 2,
        kind: "capture-analysis",
        captureId: id,
        input: { expectedRevision: 1, intent: "initial", outputContract: "structured-teaching-v1" },
      },
      {
        version: 2,
        kind: "instant-query",
        input: {
          action: "explain",
          selectionKind: "sentence",
          sourceText: "Go.",
          sourceType: "web-selection",
          outputContract: "structured-teaching-v1",
        },
      },
    ]) {
      expect(learningTaskCommandReadSchema.parse(command)).toEqual(command);
      expect(() => learningTaskCommandSchema.parse(command)).toThrow();
      expect(() => learningTaskCommandReadSchema.parse({ ...command, version: 3 })).toThrow();
    }
  });

  it("preserves every task event and cursor so an old decoder can resume through a structured event", () => {
    const events = [
      { type: "analysis.started", requestId: id, unitCount: 1 },
      { type: "analysis.structure", requestId: id, unit },
      { type: "analysis.completed", analysis: record(), quota },
    ].map((payload, index) =>
      learningTaskEventReadSchema.parse({ version: 2, taskId: id, cursor: index + 1, payload }),
    );
    const old = events.map(projectTaskEventForLegacy);
    expect(old.map((event) => [event.cursor, event.taskId, event.payload.type])).toEqual([
      [1, id, "analysis.started"],
      [2, id, "analysis.preview"],
      [3, id, "analysis.completed"],
    ]);
    const parser = createLearningTaskSseDecoder(id, 1);
    const frames = old
      .slice(1)
      .map(
        (event) => `event: learning-task\nid: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join("");
    expect(parser.push(frames)).toHaveLength(2);
    parser.finish();
    expect(parser.cursor).toBe(3);
    for (const event of old) expect(learningTaskEventSchema.parse(event)).toEqual(event);
    expect(() => learningTaskEventSchema.parse(events[1])).toThrow();
    expect(events[1]?.payload.type).toBe("analysis.structure");
  });

  it("projects retained terminal output without changing state, timing, quota or identity", () => {
    const snapshot = learningTaskSnapshotReadSchema.parse({
      version: 2,
      id,
      kind: "analysis",
      subjectId: null,
      state: "completed",
      cursor: 3,
      createdAt: now,
      updatedAt: now,
      error: null,
      timings: { totalMs: 250 },
      output: { type: "analysis.completed", analysis: record(), quota },
    });
    const projected = projectTaskSnapshotForLegacy(snapshot);
    expect(learningTaskSnapshotSchema.parse(projected)).toEqual(projected);
    expect(projected).toMatchObject({
      version: 2,
      id,
      cursor: 3,
      state: "completed",
      timings: { totalMs: 250 },
      output: { quota },
    });
    expect(projectTaskSnapshotForLegacy(projected)).toEqual(projected);
    expect(snapshot.output).toMatchObject({
      analysis: { result: { type: "sentence-passage-analysis-v3" } },
    });
  });

  it("uses valid old analysis/query previews and completed results, including generation detail", () => {
    const analysis = analysisEventReadSchema.parse({
      type: "analysis.structure",
      requestId: id,
      unit,
    });
    const oldAnalysis = projectAnalysisEventForLegacy(analysis);
    expect(analysisEventSchema.parse(oldAnalysis)).toMatchObject({
      type: "analysis.preview",
      requestId: id,
      section: "unit:u1",
    });
    const query = extensionQueryEventReadSchema.parse({
      type: "query.structure",
      generationId: id,
      sequence: 4,
      unit,
    });
    expect(extensionQueryEventSchema.parse(projectQueryEventForLegacy(query))).toMatchObject({
      type: "query.preview",
      generationId: id,
      sequence: 4,
    });
    const preview = projectQueryEventForLegacy(query);
    if (preview.type !== "query.preview") throw new Error("Expected old preview");
    // The frozen platform engine consumes query.preview through this narrower contract.
    expect(
      analysisUpdateSchema.parse({
        type: "delta",
        requestId: id,
        section: preview.section,
        sequence: preview.sequence,
        text: preview.text,
      }),
    ).toMatchObject({ section: "main-structure" });
    const completed = extensionQueryEventReadSchema.parse({
      type: "query.completed",
      generationId: id,
      quota,
      result: queryResult(),
    });
    expect(projectQueryEventForLegacy(completed)).toMatchObject({
      generationId: id,
      quota,
      result: { type: "explain-sentence" },
    });
    const detail = extensionQueryGenerationReadSchema.parse({
      state: "completed",
      id,
      createdAt: now,
      expiresAt: "2026-09-13T10:00:00Z",
      result: queryResult(),
    });
    expect(
      extensionQueryGenerationSchema.parse(projectQueryGenerationForLegacy(detail)),
    ).toMatchObject({ id, state: "completed", result: { type: "explain-sentence" } });
  });

  it("rejects a stream unit whose identity or source locations do not match its structure", () => {
    for (const changed of [
      { ...unit, analysisUnitId: "u2" },
      { ...unit, sourceText: "No." },
    ])
      expect(() =>
        analysisEventReadSchema.parse({ type: "analysis.structure", requestId: id, unit: changed }),
      ).toThrow();
  });
});

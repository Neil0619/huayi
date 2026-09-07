import {
  analysisRecordSchema,
  contractFixtures,
  type LearningTaskSnapshot,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";
import { describe, expect, it } from "vitest";

import { collectionEntries, collectionStatus, type CollectionEntry } from "./collection-model.js";

const analysis = analysisRecordSchema.parse({
  ...contractFixtures.analysis,
  studyCaptureId: "capture-1",
});
const summary = {
  id: analysis.id,
  createdAt: analysis.createdAt,
  revision: 2,
  reviewState: "reviewed" as const,
};
const capture: StudyCaptureDetailResponse = {
  activeAnalysisRequest: null,
  capture: {
    id: "capture-1",
    kind: "sentence",
    status: "analyzed",
    revision: 3,
    sourceText: analysis.sourceText,
    normalizedTextHash: "a".repeat(64),
    captureCount: 1,
    createdAt: analysis.createdAt,
    updatedAt: analysis.createdAt,
    firstCapturedAt: analysis.createdAt,
    lastCapturedAt: analysis.createdAt,
  },
  latestAnalysis: summary,
};
const task: LearningTaskSnapshot = {
  version: 2,
  id: "task-1",
  kind: "capture-analysis",
  subjectId: "capture-1",
  state: "completed",
  cursor: 1,
  createdAt: analysis.createdAt,
  updatedAt: analysis.createdAt,
  error: null,
  timings: {},
  output: { ...contractFixtures.completedEvent, analysis },
};

function requiredEntry(entry: CollectionEntry | undefined): CollectionEntry {
  if (!entry) throw new Error("Expected a capture entry.");
  return entry;
}

describe("collection entries", () => {
  it("does not reopen reviewed candidates from an older task snapshot after a list refresh", () => {
    const entry = collectionEntries([capture], [], [task])[0];
    expect(entry).toBeDefined();
    expect(entry?.analysis).toBeUndefined();
    expect(collectionStatus(requiredEntry(entry))).toBe("已整理");
  });

  it("keeps the current reviewed record instead of an old task result", () => {
    const reviewed = { ...analysis, revision: 2, reviewState: "reviewed" as const };
    expect(collectionEntries([capture], [reviewed], [task])[0]?.analysis).toEqual(reviewed);
  });

  it("ignores an old completed task when a newer analysis was fetched from the server", () => {
    const latest = {
      ...capture,
      latestAnalysis: { ...summary, id: "new-analysis", createdAt: "2026-09-07T00:00:00.000Z" },
    };
    const entry = collectionEntries([latest], [], [task])[0];
    expect(entry?.analysis).toBeUndefined();
    expect(collectionStatus(requiredEntry(entry))).toBe("已整理");
  });

  it("can still display a new task result before the capture pointer refreshes", () => {
    const next = { ...analysis, id: "new-analysis", createdAt: "2026-09-07T00:00:00.000Z" };
    const nextTask: LearningTaskSnapshot = {
      ...task,
      output: { ...contractFixtures.completedEvent, analysis: next },
    };
    expect(collectionEntries([capture], [], [nextTask])[0]?.analysis).toEqual(next);
  });
});

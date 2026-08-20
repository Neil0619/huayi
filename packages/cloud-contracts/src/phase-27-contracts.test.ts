import { describe, expect, it } from "vitest";

import {
  accountPreferencesResponseSchema,
  analysisEventSchema,
  analysisHttpRoutes,
  approveExtensionPairingRequestSchema,
  cloudWordCopyBatchRequestSchema,
  cloudWordCopyBatchResponseSchema,
  cloudWordCopyHttpRoutes,
  cloudWordCopyRequestSchema,
  cloudWordCopyResponseSchema,
  extensionPairingExchangeResponseSchema,
  extensionPreferencesResponseSchema,
  extensionQueryCleanupResponseSchema,
  extensionQueryRequestSchema,
  extensionQueryHttpRoutes,
  startAnalysisRequestSchema,
  studyCaptureCreateRequestSchema,
  studyCaptureHttpRoutes,
} from "./index.js";

const now = "2026-08-13T10:00:00.000Z";
const resourceId = "10000000-0000-0000-0000-000000000001";

describe("Phase 27 public contracts", () => {
  it("publishes five account preferences and a three-field Extension projection", () => {
    const preferences = {
      cloudWordCopyMode: "enabled",
      dailyGoal: 5,
      extensionQueryModelMode: "platform",
      revision: 3,
      studyCaptureMode: "manual",
      timezone: "Asia/Shanghai",
      updatedAt: now,
    } as const;
    expect(accountPreferencesResponseSchema.parse(preferences)).toEqual(preferences);
    expect(
      extensionPreferencesResponseSchema.parse({
        cloudWordCopyMode: "enabled",
        extensionQueryModelMode: "platform",
        revision: 3,
        studyCaptureMode: "manual",
        updatedAt: now,
      }),
    ).toBeTruthy();
  });

  it("approves pairing atomically and exchanges a preference snapshot", () => {
    const snapshot = {
      cloudWordCopyMode: "disabled",
      extensionQueryModelMode: "byok",
      revision: 4,
      studyCaptureMode: "automatic",
      updatedAt: now,
    } as const;
    expect(
      approveExtensionPairingRequestSchema.parse({
        cloudWordCopyMode: snapshot.cloudWordCopyMode,
        deviceLabel: "Chrome on Mac",
        expectedPreferencesRevision: 3,
        extensionQueryModelMode: snapshot.extensionQueryModelMode,
        studyCaptureMode: snapshot.studyCaptureMode,
      }),
    ).toBeTruthy();
    expect(
      extensionPairingExchangeResponseSchema.parse({
        expiresAt: "2026-11-11T10:00:00.000Z",
        preferences: snapshot,
        sessionToken: "s".repeat(32),
      }),
    ).toBeTruthy();
  });

  it("separates Web deep analysis from temporary Extension queries", () => {
    expect(
      startAnalysisRequestSchema.parse({
        selectionKind: "phrase",
        source: { title: "Notes", type: "manual", userContext: "写作" },
        sourceText: "to be frank",
      }),
    ).toBeTruthy();
    expect(() =>
      startAnalysisRequestSchema.parse({
        action: "deep-analyze",
        selectionKind: "phrase",
        source: { type: "manual" },
        sourceText: "to be frank",
      }),
    ).toThrow();
    expect(
      analysisEventSchema.parse({ requestId: "request-1", type: "analysis.started", unitCount: 1 }),
    ).toBeTruthy();
    expect(
      analysisEventSchema.parse({
        requestId: "request-1",
        section: "unit:u1",
        text: "短语讲解",
        type: "analysis.preview",
      }),
    ).toBeTruthy();
    expect("import" in analysisHttpRoutes).toBe(false);
  });

  it("publishes strict query, capture, and word-copy resources", () => {
    expect(extensionQueryHttpRoutes.start).toBe("/v1/extension-queries:stream");
    expect(extensionQueryHttpRoutes.cleanup).toBe("/internal/extension-queries/cleanup");
    expect(
      extensionQueryCleanupResponseSchema.parse({ abandonedCount: 100, deletedCount: 100 }),
    ).toEqual({ abandonedCount: 100, deletedCount: 100 });
    expect(() =>
      extensionQueryCleanupResponseSchema.parse({
        abandonedCount: 101,
        deletedCount: 0,
        sourceText: "private",
      }),
    ).toThrow();
    expect(studyCaptureHttpRoutes.create).toBe("/v1/study-captures");
    expect(
      extensionQueryRequestSchema.parse({
        action: "explain",
        selectionKind: "phrase",
        sentenceContext: "To be frank, I disagree.",
        sourceText: "to be frank",
        sourceType: "web-selection",
      }),
    ).toBeTruthy();
    expect(
      studyCaptureCreateRequestSchema.parse({
        kind: "sentence",
        sourceText: "This is a complete line",
      }),
    ).toBeTruthy();
    expect(
      cloudWordCopyRequestSchema.parse({
        collectedAt: now,
        contextualMeaningZh: "维持",
        headword: "sustain",
        sentence: "The effort cannot be sustained.",
      }),
    ).toBeTruthy();
    expect(() =>
      cloudWordCopyRequestSchema.parse({
        collectedAt: now,
        contextualMeaningZh: "维持",
        headword: "sustain",
        result: { hidden: true },
        sentence: "The effort cannot be sustained.",
      }),
    ).toThrow();
    expect(
      cloudWordCopyResponseSchema.parse({ contextCreated: true, wordId: resourceId }),
    ).toBeTruthy();
    const batch = cloudWordCopyBatchRequestSchema.parse({
      entries: [
        {
          contexts: [
            {
              collectedAt: now,
              contextKey: "context-sustain-1",
              contextualMeaningZh: "维持",
              sentence: "The effort cannot be sustained.",
            },
            {
              collectedAt: now,
              contextKey: "context-sustain-2",
              sentence: "Sustain the note for two beats.",
            },
          ],
          entryKey: "sustain",
          headword: "sustain",
        },
        {
          contexts: [],
          entryKey: "acquire",
          headword: "acquire",
        },
      ],
    });
    expect(
      cloudWordCopyBatchResponseSchema.parse({
        entries: [
          {
            contexts: [
              { contextKey: "context-sustain-1", outcome: "created" },
              { contextKey: "context-sustain-2", outcome: "duplicate" },
            ],
            entryKey: "sustain",
            wordId: resourceId,
            wordOutcome: "existing",
          },
          {
            contexts: [],
            entryKey: "acquire",
            wordId: resourceId,
            wordOutcome: "created",
          },
        ],
        summary: {
          contextCount: 2,
          createdContextCount: 1,
          createdWordCount: 1,
          duplicateContextCount: 1,
          existingWordCount: 1,
          wordCount: 2,
        },
      }),
    ).toBeTruthy();
    expect(() =>
      cloudWordCopyBatchRequestSchema.parse({
        entries: [batch.entries[0], batch.entries[0]],
      }),
    ).toThrow();
    expect(() =>
      cloudWordCopyBatchRequestSchema.parse({
        entries: Array.from({ length: 101 }, (_, index) => ({
          contexts: [],
          entryKey: `entry-${index}`,
          headword: `word-${index}`,
        })),
      }),
    ).toThrow();
    expect(cloudWordCopyHttpRoutes.importLocal).toBe("/v1/words:import-local");
  });
});

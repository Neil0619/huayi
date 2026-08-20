import { describe, expect, it, vi } from "vitest";

import { createCloudSubmissionApi } from "./cloud-submission-api.js";

describe("Cloud learning submission dispatcher", () => {
  it("routes only the strict discriminant to its fixed adapter", async () => {
    const studyCaptures = {
      submit: vi.fn(async () => ({
        capture: {
          captureCount: 1,
          createdAt: "2026-08-13T00:00:00.000Z",
          firstCapturedAt: "2026-08-13T00:00:00.000Z",
          id: "capture-1",
          kind: "sentence" as const,
          lastCapturedAt: "2026-08-13T00:00:00.000Z",
          normalizedTextHash: "a".repeat(64),
          revision: 1,
          sourceText: "This works.",
          status: "pending" as const,
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
        outcome: "existing" as const,
      })),
    };
    const wordCopies = {
      copy: vi.fn(async () => ({
        contextCreated: true,
        wordId: "10000000-0000-0000-0000-000000000001",
      })),
    };
    const api = createCloudSubmissionApi({ studyCaptures, wordCopies });
    const capture = {
      payload: { kind: "sentence" as const, sourceText: "This works." },
      type: "study-capture" as const,
    };
    const word = {
      payload: {
        collectedAt: "2026-08-13T00:00:00.000Z",
        contextualMeaningZh: "维持",
        headword: "sustain",
        sentence: "The effort cannot be sustained.",
      },
      type: "cloud-word-copy" as const,
    };

    await expect(api.submit(capture, "capture-key", "token")).resolves.toMatchObject({
      response: { outcome: "existing" },
      type: "study-capture",
    });
    await expect(api.submit(word, "word-key", "token")).resolves.toMatchObject({
      response: { contextCreated: true },
      type: "cloud-word-copy",
    });
    expect(studyCaptures.submit).toHaveBeenCalledWith(capture.payload, "capture-key", "token");
    expect(wordCopies.copy).toHaveBeenCalledWith(word.payload, "word-key", "token");
  });
});

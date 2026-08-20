import { describe, expect, it } from "vitest";

import {
  contractFixtures,
  createLearningItemRequestSchema,
  createLearningItemResponseSchema,
  createLearningItemWriteHeadersSchema,
  deleteLearningItemRequestSchema,
  deleteLearningItemResponseSchema,
  duplicateSuggestionsHeadersSchema,
  duplicateSuggestionsRequestSchema,
  duplicateSuggestionsResponseSchema,
  learningItemArchiveRequestSchema,
  learningItemDetailResponseSchema,
  learningItemHttpRoutes,
  learningItemListResponseSchema,
  learningItemMutationHeadersSchema,
  learningItemMergeResponseSchema,
  listLearningItemsQuerySchema,
  mergeLearningItemsRequestSchema,
  mergePreviewResponseSchema,
  patchLearningItemRequestSchema,
} from "./index.js";

describe("learning library read contracts", () => {
  it("includes item, schedule, recent practice, pagination, and fixed routes", () => {
    const result = contractFixtures.confirmCandidatesResponse.results[0];
    if (result.type !== "learning-item") throw new Error("Learning item fixture missing.");
    const view = {
      archivedAt: null,
      hasPracticeHistory: true,
      item: result.item,
      recentPractice: {
        completedAt: "2026-08-13T02:00:00.000Z",
        rating: "mastered",
        sessionId: "practice-1",
        type: "sentence-creation",
      },
      schedule: {
        consecutiveMastered: 1,
        dueAt: "2026-08-14T02:00:00.000Z",
        lastRating: "mastered",
        level: 0,
      },
    };
    expect(learningItemDetailResponseSchema.parse(view)).toEqual(view);
    expect(learningItemListResponseSchema.parse({ items: [view], nextCursor: null })).toEqual({
      items: [view],
      nextCursor: null,
    });
    expect(() =>
      learningItemDetailResponseSchema.parse({ ...view, ownerUserId: "user-a" }),
    ).toThrow();
    const missingArchiveState: Partial<typeof view> = { ...view };
    delete missingArchiveState.archivedAt;
    expect(() => learningItemDetailResponseSchema.parse(missingArchiveState)).toThrow();
    expect(
      learningItemDetailResponseSchema.parse({
        ...view,
        archivedAt: "2026-08-14T02:00:00.000Z",
      }).archivedAt,
    ).toBe("2026-08-14T02:00:00.000Z");
    expect(listLearningItemsQuerySchema.parse({})).toMatchObject({ archived: false });
    expect(learningItemHttpRoutes).toMatchObject({
      create: "/v1/learning-items",
      detail: "/v1/learning-items/:id",
      list: "/v1/learning-items",
    });
  });

  it("defines a strict manual-create request, response, and idempotency-only headers", () => {
    const result = contractFixtures.confirmCandidatesResponse.results[0];
    if (result.type !== "learning-item") throw new Error("Learning item fixture missing.");
    const request = {
      content: {
        meaningZh: "坦率地说",
        text: "to be frank",
        type: "expression",
        usageZh: "用于直接表达意见。",
      },
      systemAttributes: ["spoken"],
      tags: ["Writing"],
    };
    expect(createLearningItemRequestSchema.parse(request)).toEqual(request);
    expect(
      createLearningItemResponseSchema.parse({
        archivedAt: null,
        hasPracticeHistory: false,
        item: result.item,
        recentPractice: null,
        schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
      }),
    ).toMatchObject({ item: { type: "expression" }, schedule: { level: -1 } });
    expect(createLearningItemWriteHeadersSchema.parse({ "idempotency-key": "manual-1" })).toEqual({
      "idempotency-key": "manual-1",
    });
    expect(() =>
      createLearningItemWriteHeadersSchema.parse({
        "idempotency-key": "manual-1",
        "if-match": '"1"',
      }),
    ).toThrow();
    expect(() =>
      createLearningItemRequestSchema.parse({ ...request, tags: ["Writing", " writing "] }),
    ).toThrow();
  });

  it("defines strict update, delete, semantic suggestion, and explicit merge contracts", () => {
    const patch = {
      content: {
        meaningZh: "坦白说",
        text: "to be frank",
        type: "expression" as const,
        usageZh: "用于直接表达意见。",
      },
      expectedRevision: 2,
      systemAttributes: ["spoken"],
      tags: ["Writing"],
    };
    expect(patchLearningItemRequestSchema.parse(patch)).toEqual(patch);
    expect(deleteLearningItemRequestSchema.parse({ expectedRevision: 2 })).toEqual({
      expectedRevision: 2,
    });
    expect(learningItemArchiveRequestSchema.parse({ expectedRevision: 2 })).toEqual({
      expectedRevision: 2,
    });
    expect(
      learningItemMutationHeadersSchema.parse({
        "idempotency-key": "maintenance-1",
        "if-match": '"2"',
      }),
    ).toMatchObject({ "if-match": '"2"' });
    expect(
      deleteLearningItemResponseSchema.parse({
        deleted: true,
        deletionKind: "hard-delete",
        id: "item-1",
      }),
    ).toEqual({ deleted: true, deletionKind: "hard-delete", id: "item-1" });
    expect(
      deleteLearningItemResponseSchema.parse({
        deleted: true,
        deletionKind: "erased",
        id: "item-1",
      }),
    ).toMatchObject({ deletionKind: "erased" });
    expect(() => deleteLearningItemResponseSchema.parse({ deleted: true, id: "item-1" })).toThrow();
    expect(duplicateSuggestionsRequestSchema.parse({ expectedRevision: 2 })).toEqual({
      expectedRevision: 2,
    });
    expect(duplicateSuggestionsHeadersSchema.parse({ "idempotency-key": "suggest-1" })).toEqual({
      "idempotency-key": "suggest-1",
    });
    expect(() => duplicateSuggestionsHeadersSchema.parse({})).toThrow();
    expect(() =>
      duplicateSuggestionsHeadersSchema.parse({
        "idempotency-key": "suggest-1",
        "if-match": '"2"',
      }),
    ).toThrow();
    const suggestions = {
      itemRevision: 2,
      suggestions: [
        {
          candidate: learningItemDetailResponseSchema.parse({
            archivedAt: null,
            hasPracticeHistory: false,
            item: contractFixtures.confirmCandidatesResponse.results[0].item,
            recentPractice: null,
            schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
          }),
          confidence: 0.8,
          reasonZh: "语义用途相近。",
        },
      ],
    };
    expect(duplicateSuggestionsResponseSchema.parse(suggestions)).toEqual(suggestions);
    expect(() =>
      duplicateSuggestionsResponseSchema.parse({
        ...suggestions,
        suggestions: [{ ...suggestions.suggestions[0], ownerUserId: "user-a" }],
      }),
    ).toThrow();
    const merge = { sourceRevision: 2, targetItemId: "item-2", targetRevision: 3 };
    expect(mergeLearningItemsRequestSchema.parse(merge)).toEqual(merge);
    expect(
      mergePreviewResponseSchema.parse({
        allowed: false,
        blockedReason: "source_has_practice_history",
        scheduleDecision: "keep-target",
        source: learningItemDetailResponseSchema.parse({
          archivedAt: null,
          hasPracticeHistory: false,
          item: contractFixtures.confirmCandidatesResponse.results[0].item,
          recentPractice: null,
          schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
        }),
        target: learningItemDetailResponseSchema.parse({
          archivedAt: null,
          hasPracticeHistory: false,
          item: { ...contractFixtures.confirmCandidatesResponse.results[0].item, id: "item-2" },
          recentPractice: null,
          schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
        }),
      }),
    ).toMatchObject({ allowed: false, scheduleDecision: "keep-target" });
    expect(
      learningItemMergeResponseSchema.parse({
        deletedSourceId: "item-1",
        target: learningItemDetailResponseSchema.parse({
          archivedAt: null,
          hasPracticeHistory: false,
          item: { ...contractFixtures.confirmCandidatesResponse.results[0].item, id: "item-2" },
          recentPractice: null,
          schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
        }),
      }),
    ).toMatchObject({ deletedSourceId: "item-1" });
    expect(learningItemHttpRoutes).toMatchObject({
      archive: "/v1/learning-items/:id/archive",
      delete: "/v1/learning-items/:id",
      duplicateSuggestions: "/v1/learning-items/:id/duplicate-suggestions",
      mergeConfirm: "/v1/learning-items/:id/merge:confirm",
      mergePreview: "/v1/learning-items/:id/merge:preview",
      patch: "/v1/learning-items/:id",
      restore: "/v1/learning-items/:id/restore",
    });
  });
});

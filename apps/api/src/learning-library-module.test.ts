import {
  contractFixtures,
  createLearningItemRequestSchema,
  learningItemDetailResponseSchema,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createLearningLibraryModule,
  type LearningLibraryRepository,
} from "./learning-library-module.js";
import { createAnalysisHistoryCursor } from "./analysis-history-cursor.js";

function view(id = "item-1"): LearningItemDetailResponse {
  const result = contractFixtures.confirmCandidatesResponse.results[0];
  if (result.type !== "learning-item") throw new Error("Learning item fixture missing.");
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: { ...result.item, id },
    recentPractice: null,
    schedule: { consecutiveMastered: 0, dueAt: null, level: -1 as const },
  });
}

describe("learning library read module", () => {
  it("normalizes filters and signs keyset pagination without client filtering", async () => {
    const repository: LearningLibraryRepository = {
      create: vi.fn(async () => view()),
      findById: vi.fn(async () => view()),
      list: vi.fn(async () => ({ hasMore: true, items: [view()] })),
    };
    const module = createLearningLibraryModule({
      cursorKey: new Uint8Array(32).fill(4),
      now: () => new Date("2026-08-13T03:00:00.000Z"),
      repository,
    });

    const first = await module.list("user-a", {
      archived: false,
      due: "new",
      limit: 1,
      query: "  Frank  ",
      systemAttribute: "spoken",
      tag: " Writing ",
      type: "expression",
    });
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(repository.list).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ due: "new", limit: 1, query: "Frank", tag: "writing" }),
    );
    await module.list("user-a", {
      archived: false,
      cursor: first.nextCursor ?? undefined,
      due: "new",
      limit: 1,
      query: "Frank",
      systemAttribute: "spoken",
      tag: "Writing",
      type: "expression",
    });
    expect(repository.list).toHaveBeenLastCalledWith(
      "user-a",
      expect.objectContaining({
        boundary: expect.objectContaining({
          createdAt: view().item.createdAt,
          id: "item-1",
        }),
      }),
    );
    await expect(
      module.list("user-a", {
        archived: true,
        cursor: first.nextCursor ?? undefined,
        due: "new",
        limit: 1,
        query: "Frank",
        systemAttribute: "spoken",
        tag: "Writing",
        type: "expression",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("returns only owner-scoped detail and null for hidden ids", async () => {
    const repository: LearningLibraryRepository = {
      create: vi.fn(async () => view()),
      findById: vi.fn(async (owner, id) => (owner === "user-a" && id === "item-1" ? view() : null)),
      list: vi.fn(async () => ({ hasMore: false, items: [] })),
    };
    const module = createLearningLibraryModule({
      cursorKey: new Uint8Array(32).fill(4),
      now: () => new Date(),
      repository,
    });
    await expect(module.get("user-b", "item-1")).resolves.toBeNull();
    await expect(
      module.list("user-a", { archived: false, cursor: "tampered", limit: 1 }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects a valid analysis-history cursor signed with the same production key", async () => {
    const key = new Uint8Array(32).fill(4);
    const repository: LearningLibraryRepository = {
      create: vi.fn(async () => view()),
      findById: vi.fn(async () => null),
      list: vi.fn(async () => ({ hasMore: false, items: [] })),
    };
    const module = createLearningLibraryModule({
      cursorKey: key,
      now: () => new Date(),
      repository,
    });
    const historyCursor = createAnalysisHistoryCursor(key).encode({
      createdAt: "2026-08-13T03:00:00.000Z",
      id: "analysis-1",
    });

    await expect(
      module.list("user-a", { archived: false, cursor: historyCursor, limit: 1 }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(repository.list).not.toHaveBeenCalled();
  });

  it("prepares one canonical owner-scoped idempotent create command", async () => {
    const repository: LearningLibraryRepository = {
      create: vi.fn(async () => view("item-created")),
      findById: vi.fn(async () => null),
      list: vi.fn(async () => ({ hasMore: false, items: [] })),
    };
    const module = createLearningLibraryModule({
      cursorKey: new Uint8Array(32).fill(4),
      id: () => "item-created",
      now: () => new Date("2026-08-13T03:00:00.000Z"),
      repository,
    });
    const request = createLearningItemRequestSchema.parse({
      content: {
        meaningZh: "坦率地说",
        text: "To Be Frank",
        type: "expression",
        usageZh: "用于直接表达意见。",
      },
      systemAttributes: ["spoken"],
      tags: ["Writing"],
    });

    await expect(module.create("user-a", "manual-key-1", request)).resolves.toMatchObject({
      item: { id: "item-created" },
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalKey: "to be frank",
        id: "item-created",
        idempotencyKey: "manual-key-1",
        now: "2026-08-13T03:00:00.000Z",
        ownerUserId: "user-a",
        request,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        tags: [{ displayName: "Writing", normalizedName: "writing" }],
      }),
    );
  });
});

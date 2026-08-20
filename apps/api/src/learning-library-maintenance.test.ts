import {
  contractFixtures,
  learningItemDetailResponseSchema,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createLearningLibraryMaintenance,
  type LearningLibraryMaintenanceRepository,
} from "./learning-library-maintenance.js";

function view(id: string, revision = 1): LearningItemDetailResponse {
  const result = contractFixtures.confirmCandidatesResponse.results[0];
  if (result.type !== "learning-item") throw new Error("Learning item fixture missing.");
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: { ...result.item, id, revision },
    recentPractice: null,
    schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
  });
}

function repository(): LearningLibraryMaintenanceRepository {
  return {
    archive: vi.fn(async () => ({ ...view("item-1", 2), archivedAt: "2026-08-13T04:00:00.000Z" })),
    delete: vi.fn(async () => ({
      deleted: true as const,
      deletionKind: "hard-delete" as const,
      id: "item-1",
    })),
    merge: vi.fn(async () => ({ deletedSourceId: "item-1", target: view("item-2", 2) })),
    patch: vi.fn(async () => view("item-1", 2)),
    previewMerge: vi.fn(async () => ({
      allowed: true,
      blockedReason: null,
      scheduleDecision: "keep-target" as const,
      source: view("item-1"),
      target: view("item-2"),
    })),
    suggestionContext: vi.fn(async () => ({
      candidates: [view("item-2")],
      source: view("item-1"),
    })),
    restore: vi.fn(async () => view("item-1", 3)),
  };
}

describe("learning library maintenance module", () => {
  it("canonicalizes patch and binds revision into one idempotent command", async () => {
    const store = repository();
    const maintenance = createLearningLibraryMaintenance({
      duplicateSuggestions: { suggest: vi.fn() },
      now: () => new Date("2026-08-13T04:00:00.000Z"),
      repository: store,
    });
    const request = {
      content: {
        meaningZh: "因此",
        text: "As A Result",
        type: "expression" as const,
        usageZh: "说明结果。",
      },
      expectedRevision: 1,
      systemAttributes: ["connector"],
      tags: ["Writing"],
    };
    await maintenance.patch("user-a", "item-1", "patch-1", request);
    expect(store.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalKey: "as a result",
        expectedRevision: 1,
        id: "item-1",
        idempotencyKey: "patch-1",
        ownerUserId: "user-a",
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        tags: [{ displayName: "Writing", normalizedName: "writing" }],
      }),
    );
    await maintenance.patch("user-a", "item-2", "patch-2", request);
    const firstHash = vi.mocked(store.patch).mock.calls[0]?.[0].requestHash;
    const secondHash = vi.mocked(store.patch).mock.calls[1]?.[0].requestHash;
    expect(firstHash).not.toBe(secondHash);
  });

  it("passes the owner, browser key, and server-owned context to the paid generator", async () => {
    const store = repository();
    const duplicateSuggestions = {
      suggest: vi.fn(async () => ({
        itemRevision: 1,
        suggestions: [{ candidate: view("item-2"), confidence: 0.8, reasonZh: "语义用途相近。" }],
      })),
    };
    const maintenance = createLearningLibraryMaintenance({
      duplicateSuggestions,
      now: () => new Date(),
      repository: store,
    });
    await expect(
      maintenance.suggestions("user-a", "item-1", "suggest-1", { expectedRevision: 1 }),
    ).resolves.toEqual({
      itemRevision: 1,
      suggestions: [{ candidate: view("item-2"), confidence: 0.8, reasonZh: "语义用途相近。" }],
    });
    expect(duplicateSuggestions.suggest).toHaveBeenCalledWith({
      candidates: [view("item-2")],
      idempotencyKey: "suggest-1",
      ownerUserId: "user-a",
      source: view("item-1"),
    });
  });

  it("hashes delete and merge confirmations for snapshot replay", async () => {
    const store = repository();
    const maintenance = createLearningLibraryMaintenance({
      duplicateSuggestions: { suggest: vi.fn() },
      now: () => new Date("2026-08-13T04:00:00.000Z"),
      repository: store,
    });
    await maintenance.delete("user-a", "item-1", "delete-1", { expectedRevision: 1 });
    await maintenance.confirmMerge("user-a", "item-1", "merge-1", {
      sourceRevision: 1,
      targetItemId: "item-2",
      targetRevision: 1,
    });
    expect(store.delete).toHaveBeenCalledWith(
      expect.objectContaining({ requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u) }),
    );
    expect(store.merge).toHaveBeenCalledWith(
      expect.objectContaining({ requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u) }),
    );
  });

  it("binds archive and restore to distinct idempotent commands", async () => {
    const store = repository();
    const maintenance = createLearningLibraryMaintenance({
      duplicateSuggestions: { suggest: vi.fn() },
      now: () => new Date("2026-08-13T04:00:00.000Z"),
      repository: store,
    });

    await maintenance.archive("user-a", "item-1", "archive-1", { expectedRevision: 1 });
    await maintenance.restore("user-a", "item-1", "restore-1", { expectedRevision: 2 });

    expect(store.archive).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 1,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
    expect(store.restore).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 2,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
    expect(vi.mocked(store.archive).mock.calls[0]?.[0].requestHash).not.toBe(
      vi.mocked(store.restore).mock.calls[0]?.[0].requestHash,
    );
  });
});

import { describe, expect, it, vi } from "vitest";

import { createWordLibraryModule, type WordLibraryRepository } from "./word-library-module.js";

const word = {
  canonicalKey: "café d'art",
  createdAt: "2026-08-13T01:00:00.000Z",
  headword: "CAFÉ D’ART",
  id: "word-1",
  revision: 1,
  updatedAt: "2026-08-13T01:00:00.000Z",
};

function repository(): WordLibraryRepository {
  return {
    delete: vi.fn(async ({ wordId }) => ({ deleted: true as const, id: wordId })),
    findById: vi.fn(async () => ({ contexts: [], hasMore: false, word })),
    list: vi.fn(async () => ({ hasMore: false, items: [word] })),
    patch: vi.fn(async () => word),
    upsert: vi.fn(async () => ({
      contextOutcome: "created" as const,
      word,
      wordOutcome: "created" as const,
    })),
  };
}

describe("word library module", () => {
  it("prepares a manual server-owned upsert with stable hashes and ids", async () => {
    const repo = repository();
    const ids = vi
      .fn()
      .mockReturnValueOnce("word-new")
      .mockReturnValueOnce("context-new")
      .mockReturnValueOnce("word-next")
      .mockReturnValueOnce("context-next");
    const now = vi
      .fn()
      .mockReturnValueOnce(new Date("2026-08-13T05:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-08-14T05:00:00.000Z"));
    const module = createWordLibraryModule({
      cursorKey: Buffer.alloc(32, 8),
      ids,
      now,
      repository: repo,
    });
    const result = await module.upsert("user-1", "upsert-1", {
      context: { contextualMeaningZh: "偶遇", sourceText: "I ran into her." },
      headword: "  RUN INTO ",
      notes: "搭配",
    });
    expect(result).toMatchObject({ contextOutcome: "created", wordOutcome: "created" });
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalKey: "run into",
        context: expect.objectContaining({
          id: "context-new",
          observedAt: "2026-08-13T05:00:00.000Z",
          sourceType: "manual",
        }),
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        wordId: "word-new",
      }),
    );
    await module.upsert("user-1", "upsert-2", {
      context: { contextualMeaningZh: "偶遇", sourceText: "I ran into her." },
      headword: "run into",
    });
    const first = vi.mocked(repo.upsert).mock.calls[0]?.[0];
    const second = vi.mocked(repo.upsert).mock.calls[1]?.[0];
    expect(second?.context?.contentHash).toBe(first?.context?.contentHash);
    expect(second?.context?.observedAt).not.toBe(first?.context?.observedAt);
  });

  it("normalizes search and keeps list and context cursors resource-separated", async () => {
    const repo = repository();
    const module = createWordLibraryModule({
      cursorKey: Buffer.alloc(32, 8),
      ids: () => "unused-id",
      now: () => new Date("2026-08-13T05:00:00.000Z"),
      repository: repo,
    });
    await module.list("user-1", { limit: 20, query: "  CAFÉ\tD’ART " });
    expect(repo.list).toHaveBeenCalledWith("user-1", {
      canonicalQuery: "café d'art",
      limit: 20,
    });
    await expect(module.get("user-1", "word-1", { contextLimit: 10 })).resolves.toMatchObject({
      word: { id: "word-1" },
    });
  });

  it("binds path id into patch and delete idempotency hashes", async () => {
    const repo = repository();
    const module = createWordLibraryModule({
      cursorKey: Buffer.alloc(32, 8),
      ids: () => "unused-id",
      now: () => new Date("2026-08-13T05:00:00.000Z"),
      repository: repo,
    });
    await module.patch("user-1", "word-1", "patch-1", { expectedRevision: 1, notes: null });
    await module.delete("user-1", "word-1", "delete-1", { expectedRevision: 2 });
    const patch = vi.mocked(repo.patch).mock.calls[0]?.[0];
    const deletion = vi.mocked(repo.delete).mock.calls[0]?.[0];
    expect(patch?.requestHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(deletion?.requestHash).not.toBe(patch?.requestHash);
    expect(deletion).toMatchObject({ ownerUserId: "user-1", wordId: "word-1" });
  });
});

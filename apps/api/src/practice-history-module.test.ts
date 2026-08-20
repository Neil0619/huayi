import { describe, expect, it, vi } from "vitest";

import {
  createPracticeHistoryModule,
  type PracticeHistoryRepository,
} from "./practice-history-module.js";

function summary(id: string, completedAt: string | null) {
  return {
    completedAt,
    createdAt: "2026-08-13T05:00:00.000Z",
    id,
    items: [{ itemId: "item-1" }],
    revision: 1,
    status: completedAt === null ? ("active" as const) : ("completed" as const),
    type: "sentence-creation" as const,
    updatedAt: "2026-08-13T05:05:00.000Z",
  };
}

function repository(): PracticeHistoryRepository {
  return {
    delete: vi.fn(async () => ({ deleted: true as const, id: "session-1" })),
    findById: vi.fn(async () => null),
    list: vi.fn(async () => ({ hasMore: true, items: [summary("session-1", null)] })),
  };
}

describe("practice history module", () => {
  it("normalizes filters and signs stable pagination without client date authority", async () => {
    const store = repository();
    const history = createPracticeHistoryModule({
      cursorKey: new Uint8Array(32).fill(7),
      now: () => new Date("2026-08-13T06:00:00.000Z"),
      repository: store,
    });
    const first = await history.list("user-a", { limit: 1, status: "active" });
    expect(first.nextCursor).toEqual(expect.any(String));
    await history.list("user-a", { cursor: first.nextCursor ?? undefined, limit: 1 });
    expect(store.list).toHaveBeenLastCalledWith(
      "user-a",
      expect.objectContaining({ boundary: { completedAt: null, id: "session-1" }, limit: 1 }),
    );
  });

  it("hashes path/revision for post-delete replay and delegates owner-scoped detail", async () => {
    const store = repository();
    const history = createPracticeHistoryModule({
      cursorKey: new Uint8Array(32).fill(7),
      now: () => new Date("2026-08-13T06:00:00.000Z"),
      repository: store,
    });
    await history.delete("user-a", "session-1", "delete-1", { expectedRevision: 3 });
    expect(store.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 3,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        sessionId: "session-1",
      }),
    );
    await expect(history.get("user-b", "session-1")).resolves.toBeNull();
  });
});

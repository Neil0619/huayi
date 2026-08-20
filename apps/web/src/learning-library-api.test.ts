import {
  contractFixtures,
  learningItemDetailResponseSchema,
  type CreateLearningItemRequest,
  type PatchLearningItemRequest,
} from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import { createWebLearningLibraryApi } from "./learning-library-api.js";

function view() {
  const result = contractFixtures.confirmCandidatesResponse.results[0];
  if (result.type !== "learning-item") throw new Error("Learning item fixture missing.");
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: result.item,
    recentPractice: null,
    schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
  });
}

describe("Web learning library API", () => {
  it("uses only fixed owner-scoped GET routes and server query filters", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ items: [view()], nextCursor: null }))
      .mockResolvedValueOnce(Response.json(view()));
    const api = createWebLearningLibraryApi({ apiOrigin: "https://api.huayi.invalid", fetch });
    await api.listLearningItems({
      archived: false,
      due: "new",
      limit: 10,
      query: "100%_",
      tag: "Writing",
    });
    await api.getLearningItem("item-1");
    const listUrl = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(listUrl.pathname).toBe("/v1/learning-items");
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({
      archived: "false",
      due: "new",
      limit: "10",
      query: "100%_",
      tag: "Writing",
    });
    expect(fetch.mock.calls[0]?.[1]).toEqual({ credentials: "include" });
    expect(String(fetch.mock.calls[1]?.[0])).toContain("/v1/learning-items/item-1");
  });

  it("rejects invalid ids before fetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const api = createWebLearningLibraryApi({ apiOrigin: "https://api.huayi.invalid", fetch });
    await expect(api.getLearningItem("bad/id")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("strictly validates manual creates before a Cookie, Origin, and CSRF request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(view()));
    const api = createWebLearningLibraryApi({
      apiOrigin: "https://api.huayi.invalid",
      csrfToken: async () => "csrf-proof",
      fetch,
    });
    const request: CreateLearningItemRequest = {
      content: {
        meaningZh: "坦率地说",
        text: "to be frank",
        type: "expression",
        usageZh: "用于直接表达意见。",
      },
      systemAttributes: ["spoken"],
      tags: ["Writing"],
    };
    await expect(api.createLearningItem(request, "manual-1")).resolves.toEqual(view());
    expect(fetch).toHaveBeenCalledWith(new URL("https://api.huayi.invalid/v1/learning-items"), {
      body: JSON.stringify(request),
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "manual-1",
        "x-csrf-token": "csrf-proof",
      },
      method: "POST",
    });

    await expect(
      api.createLearningItem(
        { ...request, ownerUserId: "user-b" } as CreateLearningItemRequest,
        "manual-2",
      ),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("exposes only a safe strict error code for duplicate recovery", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { code: "exact_duplicate", message: "duplicate", requestId: "request-1" } },
          { status: 409 },
        ),
      );
    const api = createWebLearningLibraryApi({
      apiOrigin: "https://api.huayi.invalid",
      csrfToken: async () => "csrf-proof",
      fetch,
    });
    await expect(
      api.createLearningItem(
        {
          content: {
            meaningZh: "因此",
            text: "as a result",
            type: "expression",
            usageZh: "用于说明结果。",
          },
          systemAttributes: [],
          tags: [],
        },
        "manual-1",
      ),
    ).rejects.toMatchObject({ code: "exact_duplicate" });
  });

  it("uses strict fixed maintenance routes, revisions, idempotency, Cookie, and CSRF", async () => {
    const updated = { ...view(), item: { ...view().item, revision: 2 } };
    const archived = {
      ...updated,
      archivedAt: "2026-08-14T03:00:00.000Z",
      item: { ...updated.item, revision: 3 },
    };
    const restored = { ...archived, archivedAt: null, item: { ...archived.item, revision: 4 } };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(updated))
      .mockResolvedValueOnce(
        Response.json({ deleted: true, deletionKind: "hard-delete", id: "item-1" }),
      )
      .mockResolvedValueOnce(Response.json({ itemRevision: 2, suggestions: [] }))
      .mockResolvedValueOnce(
        Response.json({
          allowed: true,
          blockedReason: null,
          scheduleDecision: "keep-target",
          source: updated,
          target: view(),
        }),
      )
      .mockResolvedValueOnce(Response.json({ deletedSourceId: "item-1", target: updated }))
      .mockResolvedValueOnce(Response.json(archived))
      .mockResolvedValueOnce(Response.json(restored));
    const api = createWebLearningLibraryApi({
      apiOrigin: "https://api.huayi.invalid",
      csrfToken: async () => "csrf-proof",
      fetch,
    });
    const patch: PatchLearningItemRequest = {
      content: view().item.content,
      expectedRevision: 1,
      systemAttributes: [],
      tags: [],
    };
    await api.patchLearningItem("item-1", patch, "patch-1");
    await api.deleteLearningItem("item-1", { expectedRevision: 1 }, "delete-1");
    await api.suggestLearningItemDuplicates("item-1", { expectedRevision: 2 }, "suggest-1");
    const merge = { sourceRevision: 2, targetItemId: "item-2", targetRevision: 1 };
    await api.previewLearningItemMerge("item-1", merge);
    await api.confirmLearningItemMerge("item-1", merge, "merge-1");
    await api.archiveLearningItem("item-1", { expectedRevision: 2 }, "archive-1");
    await api.restoreLearningItem("item-1", { expectedRevision: 3 }, "restore-1");

    expect(fetch.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
      "/v1/learning-items/item-1",
      "/v1/learning-items/item-1",
      "/v1/learning-items/item-1/duplicate-suggestions",
      "/v1/learning-items/item-1/merge:preview",
      "/v1/learning-items/item-1/merge:confirm",
      "/v1/learning-items/item-1/archive",
      "/v1/learning-items/item-1/restore",
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      headers: expect.objectContaining({
        "idempotency-key": "patch-1",
        "if-match": '"1"',
        "x-csrf-token": "csrf-proof",
      }),
      method: "PATCH",
    });
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "idempotency-key": "suggest-1",
        "x-csrf-token": "csrf-proof",
      }),
      method: "POST",
    });
    expect(fetch.mock.calls[4]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "if-match": '"2"' }),
      method: "POST",
    });
    expect(fetch.mock.calls[5]?.[1]).toMatchObject({
      body: JSON.stringify({ expectedRevision: 2 }),
      headers: expect.objectContaining({
        "idempotency-key": "archive-1",
        "if-match": '"2"',
      }),
      method: "POST",
    });
    expect(fetch.mock.calls[6]?.[1]).toMatchObject({
      body: JSON.stringify({ expectedRevision: 3 }),
      headers: expect.objectContaining({
        "idempotency-key": "restore-1",
        "if-match": '"3"',
      }),
      method: "POST",
    });
  });
});

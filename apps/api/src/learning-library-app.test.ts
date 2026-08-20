import { contractFixtures, learningItemDetailResponseSchema } from "@huayi/cloud-contracts";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";
import { createLearningLibraryApp } from "./learning-library-app.js";
import { createLearningLibraryModule } from "./learning-library-module.js";
import { createLearningLibraryMaintenance } from "./learning-library-maintenance.js";

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

function app(ownerUserId: string) {
  const module = createLearningLibraryModule({
    cursorKey: new Uint8Array(32).fill(5),
    now: () => new Date("2026-08-13T03:00:00.000Z"),
    repository: {
      create: async () => view(),
      findById: async (owner, id) => (owner === "user-a" && id === "item-1" ? view() : null),
      list: async (owner, query) => ({
        hasMore: false,
        items: owner === "user-a" && query.type === "expression" ? [view()] : [],
      }),
    },
  });
  const maintenance = createLearningLibraryMaintenance({
    duplicateSuggestions: {
      suggest: async ({ source }) => ({ itemRevision: source.item.revision, suggestions: [] }),
    },
    now: () => new Date("2026-08-13T03:00:00.000Z"),
    repository: {
      archive: async () => ({ ...view(), archivedAt: "2026-08-13T03:00:00.000Z" }),
      delete: async ({ id }) => ({ deleted: true, deletionKind: "hard-delete", id }),
      merge: async ({ id, targetItemId }) => ({
        deletedSourceId: id,
        target: { ...view(), item: { ...view().item, id: targetItemId, revision: 2 } },
      }),
      patch: async () => ({ ...view(), item: { ...view().item, revision: 2 } }),
      previewMerge: async (_owner, _source, request) => ({
        allowed: true,
        blockedReason: null,
        scheduleDecision: "keep-target",
        source: view(),
        target: { ...view(), item: { ...view().item, id: request.targetItemId } },
      }),
      suggestionContext: async () => ({ candidates: [], source: view() }),
      restore: async () => view(),
    },
  });
  const outer = new Hono();
  outer.onError((error, context) => {
    const fault =
      error instanceof CloudFault
        ? error
        : new CloudFault("invalid_request", "The request could not be completed.");
    return context.json(
      { error: { code: fault.code, message: fault.message, requestId: "request-1" } },
      errorStatus(fault.code),
    );
  });
  outer.route(
    "/",
    createLearningLibraryApp({ authenticate: () => ownerUserId, maintenance, module }),
  );
  return outer;
}

describe("learning library HTTP", () => {
  it("returns strict owner list/detail and hides cross-owner ids as 404", async () => {
    const list = await app("user-a").request("/v1/learning-items?type=expression&limit=20");
    expect(await list.json()).toMatchObject({ items: [{ item: { id: "item-1" } }] });
    expect((await app("user-a").request("/v1/learning-items/item-1")).status).toBe(200);
    const hidden = await app("user-b").request("/v1/learning-items/item-1");
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("rejects unknown list query fields", async () => {
    const response = await app("user-a").request("/v1/learning-items?ownerUserId=user-b");
    expect(response.status).toBe(400);
  });

  it("creates through the fixed route with a strict idempotency header", async () => {
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
    const created = await app("user-a").request("/v1/learning-items", {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json", "idempotency-key": "manual-1" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ item: { id: "item-1" }, schedule: { level: -1 } });

    const missingKey = await app("user-a").request("/v1/learning-items", {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(missingKey.status).toBe(400);
  });

  it("requires matching revision headers for maintenance and keeps preview non-authoritative", async () => {
    const input = {
      content: view().item.content,
      expectedRevision: 1,
      systemAttributes: [],
      tags: [],
    };
    const patched = await app("user-a").request("/v1/learning-items/item-1", {
      body: JSON.stringify(input),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "patch-1",
        "if-match": '"1"',
      },
      method: "PATCH",
    });
    expect(patched.status).toBe(200);
    const mismatch = await app("user-a").request("/v1/learning-items/item-1", {
      body: JSON.stringify(input),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "patch-1",
        "if-match": '"2"',
      },
      method: "PATCH",
    });
    expect(mismatch.status).toBe(400);
    const preview = await app("user-a").request("/v1/learning-items/item-1/merge:preview", {
      body: JSON.stringify({ sourceRevision: 1, targetItemId: "item-2", targetRevision: 1 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ allowed: true, scheduleDecision: "keep-target" });
  });

  it("requires an idempotency key for model suggestions and forbids caching", async () => {
    const path = "/v1/learning-items/item-1/duplicate-suggestions";
    const request = {
      body: JSON.stringify({ expectedRevision: 1 }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "suggest-1",
      },
      method: "POST",
    };
    const suggested = await app("user-a").request(path, request);
    expect(suggested.status).toBe(200);
    expect(suggested.headers.get("cache-control")).toBe("private, no-store");
    expect(await suggested.json()).toEqual({ itemRevision: 1, suggestions: [] });

    const missingKey = await app("user-a").request(path, {
      ...request,
      headers: { "content-type": "application/json" },
    });
    expect(missingKey.status).toBe(400);

    const revisionHeader = await app("user-a").request(path, {
      ...request,
      headers: { ...request.headers, "if-match": '"1"' },
    });
    expect(revisionHeader.status).toBe(400);
  });

  it("archives and restores only through fixed revision-protected routes", async () => {
    const headers = {
      "content-type": "application/json",
      "idempotency-key": "archive-1",
      "if-match": '"1"',
    };
    const archived = await app("user-a").request("/v1/learning-items/item-1/archive", {
      body: JSON.stringify({ expectedRevision: 1 }),
      headers,
      method: "POST",
    });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({
      archivedAt: "2026-08-13T03:00:00.000Z",
    });
    const restored = await app("user-a").request("/v1/learning-items/item-1/restore", {
      body: JSON.stringify({ expectedRevision: 2 }),
      headers: { ...headers, "idempotency-key": "restore-1", "if-match": '"2"' },
      method: "POST",
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ archivedAt: null });
  });
});

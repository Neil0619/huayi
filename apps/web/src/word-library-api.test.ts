import { describe, expect, it, vi } from "vitest";

import { createWebWordLibraryApi } from "./word-library-api.js";

describe("Web word library API", () => {
  it("uses fixed Cookie GET routes and strict revision mutation headers", async () => {
    const word = {
      canonicalKey: "notwithstanding",
      createdAt: "2026-08-13T01:00:00.000Z",
      headword: "notwithstanding",
      id: "word-1",
      revision: 1,
      updatedAt: "2026-08-13T01:00:00.000Z",
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ contextOutcome: "created", word, wordOutcome: "created" }),
      )
      .mockResolvedValueOnce(Response.json({ items: [word], nextCursor: null }))
      .mockResolvedValueOnce(Response.json({ contexts: { items: [], nextCursor: null }, word }))
      .mockResolvedValueOnce(Response.json({ ...word, revision: 2 }))
      .mockResolvedValueOnce(Response.json({ deleted: true, id: "word-1" }));
    const api = createWebWordLibraryApi({
      apiOrigin: "https://api.huayi.invalid",
      csrfToken: async () => "csrf-proof",
      fetch,
    });
    await api.upsertWord(
      { context: { sourceText: "It notwithstanding." }, headword: "notwithstanding" },
      "upsert-1",
    );
    await api.listWords({ limit: 20, query: "not" });
    await api.getWord("word-1", { contextLimit: 20 });
    await api.patchWord("word-1", { expectedRevision: 1, notes: "转折" }, "patch-1");
    await api.deleteWord("word-1", { expectedRevision: 2 }, "delete-1");
    expect(fetch.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
      "/v1/words",
      "/v1/words",
      "/v1/words/word-1",
      "/v1/words/word-1",
      "/v1/words/word-1",
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      headers: expect.objectContaining({
        "idempotency-key": "upsert-1",
        "x-csrf-token": "csrf-proof",
      }),
      method: "POST",
    });
    expect(fetch.mock.calls[3]?.[1]).toMatchObject({
      credentials: "include",
      headers: expect.objectContaining({
        "idempotency-key": "patch-1",
        "if-match": '"1"',
        "x-csrf-token": "csrf-proof",
      }),
      method: "PATCH",
    });
    expect(fetch.mock.calls[4]?.[1]).toMatchObject({ method: "DELETE" });
  });
});

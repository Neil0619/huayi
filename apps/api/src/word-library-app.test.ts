import { describe, expect, it, vi } from "vitest";

import { createWordLibraryApp } from "./word-library-app.js";
import { createWordLibraryModule, type WordLibraryRepository } from "./word-library-module.js";
import { createWordListExport } from "./word-list-export.js";

const word = {
  canonicalKey: "run into",
  createdAt: "2026-08-13T01:00:00.000Z",
  headword: "run into",
  id: "word-1",
  revision: 1,
  updatedAt: "2026-08-13T01:00:00.000Z",
};

function app() {
  const repository: WordLibraryRepository = {
    delete: vi.fn(async ({ wordId }) => ({ deleted: true as const, id: wordId })),
    findById: vi.fn(async () => ({ contexts: [], hasMore: false, word })),
    list: vi.fn(async () => ({ hasMore: false, items: [word] })),
    patch: vi.fn(async () => ({ ...word, revision: 2 })),
    upsert: vi.fn(async () => ({
      contextOutcome: "created" as const,
      word,
      wordOutcome: "created" as const,
    })),
  };
  return createWordLibraryApp({
    authenticate: () => "user-1",
    exportWords: createWordListExport({
      repository: { listCanonicalKeys: async () => ["accountable", "make do"] },
    }),
    module: createWordLibraryModule({
      cursorKey: Buffer.alloc(32, 9),
      ids: () => "unused-id",
      now: () => new Date("2026-08-13T05:00:00.000Z"),
      repository,
    }),
  });
}

describe("word library routes", () => {
  it("accepts strict idempotent manual upserts", async () => {
    const server = app();
    const response = await server.request("/v1/words", {
      body: JSON.stringify({
        context: { sourceText: "I ran into her." },
        headword: "run into",
      }),
      headers: { "content-type": "application/json", "idempotency-key": "upsert-1" },
      method: "POST",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      contextOutcome: "created",
      word: { id: "word-1" },
      wordOutcome: "created",
    });
  });

  it("serves strict owner list and detail views", async () => {
    const server = app();
    expect((await server.request("/v1/words?query=run")).status).toBe(200);
    const detail = await server.request("/v1/words/word-1?contextLimit=10");
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({ word: { id: "word-1" } });
  });

  it("requires matching If-Match for mutation", async () => {
    const server = app();
    const deletion = await server.request("/v1/words/word-1", {
      body: JSON.stringify({ expectedRevision: 1 }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "delete-1",
        "if-match": '"1"',
      },
      method: "DELETE",
    });
    expect(deletion.status).toBe(200);
    await expect(deletion.json()).resolves.toEqual({ deleted: true, id: "word-1" });
  });

  it("downloads the canonical interoperability list without metadata", async () => {
    const response = await app().request("/v1/words:export");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="huayi-words.txt"',
    );
    await expect(response.text()).resolves.toBe("accountable\nmake do\n");
  });
});

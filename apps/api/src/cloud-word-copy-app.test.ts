import { describe, expect, it, vi } from "vitest";

import { createCloudWordCopyApp } from "./cloud-word-copy-app.js";
import { createCloudWordCopyModule } from "./cloud-word-copy-module.js";

function app() {
  const copy = vi.fn(async () => ({
    contextCreated: true,
    wordId: "10000000-0000-0000-0000-000000000001",
  }));
  const importBatch = vi.fn(async (command) => ({
    entries: command.entries.map(
      (entry: { contexts: { contextKey: string }[]; entryKey: string; wordId: string }) => ({
        contexts: entry.contexts.map((context) => ({
          contextKey: context.contextKey,
          outcome: "created" as const,
        })),
        entryKey: entry.entryKey,
        wordId: entry.wordId,
        wordOutcome: "created" as const,
      }),
    ),
    summary: {
      contextCount: 1,
      createdContextCount: 1,
      createdWordCount: 1,
      duplicateContextCount: 0,
      existingWordCount: 0,
      wordCount: 1,
    },
  }));
  const authenticate = vi.fn(async () => "owner-a");
  return {
    authenticate,
    copy,
    server: createCloudWordCopyApp({
      authenticate,
      module: createCloudWordCopyModule({
        ids: () => "10000000-0000-0000-0000-000000000001",
        now: () => new Date("2026-08-13T10:00:00.000Z"),
        repository: { copy, importBatch },
      }),
    }),
  };
}

describe("CloudWordCopy Extension routes", () => {
  it("copies one strict local observation under the authenticated owner", async () => {
    const { authenticate, server } = app();
    const response = await server.request("/v1/words:copy", {
      body: JSON.stringify({
        collectedAt: "2026-08-12T08:00:00.000Z",
        contextualMeaningZh: "维持",
        headword: "sustain",
        sentence: "The effort cannot be sustained.",
      }),
      headers: { "content-type": "application/json", "idempotency-key": "copy-key" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      contextCreated: true,
      wordId: "10000000-0000-0000-0000-000000000001",
    });
    expect(authenticate).toHaveBeenCalledOnce();
  });

  it("imports only a confirmed bounded local batch", async () => {
    const { server } = app();
    const response = await server.request("/v1/words:import-local", {
      body: JSON.stringify({
        entries: [
          {
            contexts: [
              {
                collectedAt: "2026-08-12T08:00:00.000Z",
                contextKey: "local-sustain-context-1",
                contextualMeaningZh: "维持",
                sentence: "The effort cannot be sustained.",
              },
            ],
            entryKey: "local-sustain",
            headword: "sustain",
          },
        ],
      }),
      headers: { "content-type": "application/json", "idempotency-key": "batch-key" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entries: [{ entryKey: "local-sustain", wordOutcome: "created" }],
      summary: { contextCount: 1, wordCount: 1 },
    });
  });

  it("rejects payload authority fields before the repository", async () => {
    const { copy, server } = app();
    const response = await server.request("/v1/words:copy", {
      body: JSON.stringify({
        collectedAt: "2026-08-12T08:00:00.000Z",
        contextualMeaningZh: "维持",
        headword: "sustain",
        owner: "forged",
        sentence: "The effort cannot be sustained.",
      }),
      headers: { "content-type": "application/json", "idempotency-key": "copy-key" },
      method: "POST",
    });

    expect(response.status).toBe(500);
    expect(copy).not.toHaveBeenCalled();
  });
});

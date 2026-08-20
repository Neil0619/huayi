import { describe, expect, it, vi } from "vitest";

import type { CloudWordCopyBatchRequest } from "@huayi/cloud-contracts";
import type { WordEntry } from "@huayi/store-domain";

import { CloudWordCopyError } from "./cloud-word-copy-api.js";
import { createLocalWordImporter } from "./local-word-importer.js";
import type { LocalWordImportJob } from "./local-word-import-vault.js";

const now = "2026-08-13T00:00:00.000Z";

function entry(index: number, contexts: WordEntry["contexts"] = []): WordEntry {
  const headword = `word-${String(index).padStart(3, "0")}`;
  return { contexts, createdAt: now, headword, id: headword, updatedAt: now };
}

function harness(entries: WordEntry[]) {
  let job: LocalWordImportJob | null = null;
  let key = 0;
  const api = {
    importLocal: vi.fn(
      async (request: CloudWordCopyBatchRequest, batchKey: string, token: string) => {
        void batchKey;
        void token;
        return {
          entries: request.entries.map((item) => ({
            contexts: item.contexts.map((context) => ({
              contextKey: context.contextKey,
              outcome: "created" as const,
            })),
            entryKey: item.entryKey,
            wordId: item.entryKey,
            wordOutcome: "created" as const,
          })),
          summary: {
            contextCount: request.entries.reduce((total, item) => total + item.contexts.length, 0),
            createdContextCount: request.entries.reduce(
              (total, item) => total + item.contexts.length,
              0,
            ),
            createdWordCount: request.entries.length,
            duplicateContextCount: 0,
            existingWordCount: 0,
            wordCount: request.entries.length,
          },
        };
      },
    ),
  };
  const importer = createLocalWordImporter({
    allowUpload: async () => true,
    api,
    clientVersion: "1.0.0",
    createIdempotencyKey: () => `local-import-${++key}`,
    crypto: globalThis.crypto,
    lexicon: { snapshot: async () => entries },
    now: () => new Date(now),
    sessionVault: {
      clearSession: vi.fn(async () => undefined),
      readSession: vi.fn(async () => ({
        expiresAt: "2026-08-14T00:00:00.000Z",
        token: "s".repeat(43),
      })),
    },
    vault: {
      clear: async () => {
        job = null;
      },
      read: async () => structuredClone(job),
      write: async (next) => {
        job = structuredClone(next);
      },
    },
  });
  return { api, importer };
}

describe("LocalWordImporter", () => {
  it("previews once, preserves headword-only entries, and automatically processes 100-word batches", async () => {
    const { api, importer } = harness(Array.from({ length: 201 }, (_, index) => entry(index)));
    const preview = await importer.preview();
    expect(preview).toMatchObject({ contextCount: 0, outcome: "preview", wordCount: 201 });
    if (preview.outcome !== "preview") throw new Error("Expected preview.");

    await expect(importer.confirm(preview.previewId)).resolves.toMatchObject({
      pending: true,
      response: { outcome: "progress", processedWordCount: 100, wordCount: 201 },
    });
    await expect(importer.processOne()).resolves.toMatchObject({ pending: true });
    await expect(importer.processOne()).resolves.toMatchObject({
      pending: false,
      response: { createdWordCount: 201, outcome: "completed", wordCount: 201 },
    });
    expect(api.importLocal.mock.calls.map(([request]) => request.entries.length)).toEqual([
      100, 100, 1,
    ]);
    expect(api.importLocal.mock.calls.map(([, key]) => key)).toEqual([
      "local-import-1",
      "local-import-2",
      "local-import-3",
    ]);
  });

  it("keeps all local contexts and reuses the batch key after a transient failure", async () => {
    const contexts: WordEntry["contexts"] = [
      {
        contextualMeaningZh: "维持",
        id: "context-web",
        observedAt: now,
        sentence: "Sustain the effort.",
        source: "web",
      },
      {
        id: "context-eudic",
        observedAt: now,
        sentence: "sustain /səˈsteɪn/",
        source: "eudic-import",
      },
    ];
    const { api, importer } = harness([entry(1, contexts)]);
    api.importLocal.mockRejectedValueOnce(new CloudWordCopyError("transient"));
    const preview = await importer.preview();
    if (preview.outcome !== "preview") throw new Error("Expected preview.");

    await expect(importer.confirm(preview.previewId)).resolves.toMatchObject({
      pending: true,
      response: { outcome: "retry-pending" },
    });
    await expect(importer.processOne()).resolves.toMatchObject({
      pending: false,
      response: { contextCount: 2, outcome: "completed" },
    });
    expect(api.importLocal.mock.calls.map(([, key]) => key)).toEqual([
      "local-import-1",
      "local-import-1",
    ]);
    expect(api.importLocal.mock.calls[1]?.[0].entries[0]?.contexts).toEqual([
      {
        collectedAt: now,
        contextKey: "context-web",
        contextualMeaningZh: "维持",
        sentence: "Sustain the effort.",
      },
      {
        collectedAt: now,
        contextKey: "context-eudic",
        sentence: "sustain /səˈsteɪn/",
      },
    ]);
  });

  it("rejects confirmation when the local snapshot changed after preview", async () => {
    const entries = [entry(1)];
    const { api, importer } = harness(entries);
    const preview = await importer.preview();
    if (preview.outcome !== "preview") throw new Error("Expected preview.");
    entries.push(entry(2));

    await expect(importer.confirm(preview.previewId)).resolves.toMatchObject({
      pending: false,
      response: { outcome: "snapshot-changed" },
    });
    expect(api.importLocal).not.toHaveBeenCalled();
  });
});

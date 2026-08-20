import { describe, expect, it, vi } from "vitest";

import { createCloudWordCopyModule } from "./cloud-word-copy-module.js";

const now = new Date("2026-08-13T10:00:00.000Z");

describe("CloudWordCopy module", () => {
  it("prepares one minimal extension observation without accepting authority fields", async () => {
    const copy = vi.fn(async () => ({
      contextCreated: true,
      wordId: "10000000-0000-0000-0000-000000000001",
    }));
    const module = createCloudWordCopyModule({
      ids: () => "10000000-0000-0000-0000-000000000001",
      now: () => now,
      repository: { copy, importBatch: vi.fn() },
    });

    await expect(
      module.copy("user-a", "copy-key", {
        collectedAt: "2026-08-12T08:00:00.000Z",
        contextualMeaningZh: "维持",
        headword: " Sustain ",
        sentence: "The effort cannot be sustained.",
      }),
    ).resolves.toEqual({
      contextCreated: true,
      wordId: "10000000-0000-0000-0000-000000000001",
    });
    expect(copy).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: expect.objectContaining({
          canonicalKey: "sustain",
          contexts: [
            expect.objectContaining({
              collectedAt: "2026-08-12T08:00:00.000Z",
              contextualMeaningZh: "维持",
              sentence: "The effort cannot be sustained.",
              sourceType: "extension-collection",
            }),
          ],
          headword: "Sustain",
        }),
        idempotencyKey: "copy-key",
        ownerUserId: "user-a",
      }),
    );
    await expect(
      module.copy("user-a", "copy-key", {
        collectedAt: "2026-08-12T08:00:00.000Z",
        contextualMeaningZh: "维持",
        headword: "sustain",
        owner: "forged",
        sentence: "The effort cannot be sustained.",
      }),
    ).rejects.toThrow();
  });

  it("preserves stable entry keys through a confirmed bounded batch", async () => {
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
        contextCount: 2,
        createdContextCount: 2,
        createdWordCount: 2,
        duplicateContextCount: 0,
        existingWordCount: 0,
        wordCount: 2,
      },
    }));
    const ids = [
      "10000000-0000-0000-0000-000000000001",
      "20000000-0000-0000-0000-000000000001",
      "10000000-0000-0000-0000-000000000002",
      "20000000-0000-0000-0000-000000000002",
    ];
    const module = createCloudWordCopyModule({
      ids: () => ids.shift() ?? "30000000-0000-0000-0000-000000000001",
      now: () => now,
      repository: { copy: vi.fn(), importBatch },
    });
    const input = {
      entries: [
        {
          contexts: [
            {
              collectedAt: "2026-08-12T08:00:00.000Z",
              contextKey: "local-sustain-context-1",
              contextualMeaningZh: "维持",
              sentence: "The effort cannot be sustained.",
            },
            {
              collectedAt: "2026-08-12T09:00:00.000Z",
              contextKey: "local-sustain-context-2",
              sentence: "Sustain the note.",
            },
          ],
          entryKey: "local-sustain",
          headword: "sustain",
        },
        {
          contexts: [],
          entryKey: "local-acquire",
          headword: "acquire",
        },
      ],
    };

    await expect(module.importLocal("user-a", "batch-key", input)).resolves.toMatchObject({
      entries: [{ entryKey: "local-sustain" }, { entryKey: "local-acquire" }],
    });
    expect(importBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            contexts: [
              expect.objectContaining({
                contextKey: "local-sustain-context-1",
                sourceType: "extension-local-import",
              }),
              expect.objectContaining({
                contextKey: "local-sustain-context-2",
                sourceType: "extension-local-import",
              }),
            ],
          }),
          expect.objectContaining({ contexts: [], entryKey: "local-acquire" }),
        ],
      }),
    );
  });
});

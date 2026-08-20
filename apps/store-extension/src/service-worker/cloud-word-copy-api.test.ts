import { describe, expect, it, vi } from "vitest";

import { createCloudWordCopyApi } from "./cloud-word-copy-api.js";

const input = {
  collectedAt: "2026-08-13T00:00:00.000Z",
  contextualMeaningZh: "维持",
  headword: "sustain",
  sentence: "The effort cannot be sustained.",
};

describe("CloudWordCopy HTTP adapter", () => {
  it("posts only the strict copy payload with fixed Extension proof", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            contextCreated: true,
            wordId: "10000000-0000-0000-0000-000000000001",
          }),
          { status: 200 },
        ),
    );
    const api = createCloudWordCopyApi({
      apiOrigin: "https://api.huayi.example",
      clientVersion: "1.0.0",
      fetch,
    });

    await expect(api.copy(input, "copy-key", "s".repeat(43))).resolves.toEqual({
      contextCreated: true,
      wordId: "10000000-0000-0000-0000-000000000001",
    });
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://api.huayi.example/v1/words:copy"),
      expect.objectContaining({
        body: JSON.stringify(input),
        credentials: "omit",
        headers: expect.objectContaining({
          Authorization: `HuayiExtension ${"s".repeat(43)}`,
          "Idempotency-Key": "copy-key",
          "X-Huayi-Client-Version": "1.0.0",
        }),
        method: "POST",
      }),
    );
  });

  it("posts the confirmed local batch and classifies upgrade failures", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entries: [
              {
                contexts: [{ contextKey: "local-context-1", outcome: "created" }],
                entryKey: "local-sustain",
                wordId: "10000000-0000-0000-0000-000000000001",
                wordOutcome: "created",
              },
            ],
            summary: {
              contextCount: 1,
              createdContextCount: 1,
              createdWordCount: 1,
              duplicateContextCount: 0,
              existingWordCount: 0,
              wordCount: 1,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 426 }));
    const api = createCloudWordCopyApi({
      apiOrigin: "https://api.huayi.example",
      clientVersion: "1.0.0",
      fetch,
    });
    const batch = {
      entries: [
        {
          contexts: [
            {
              collectedAt: input.collectedAt,
              contextKey: "local-context-1",
              contextualMeaningZh: input.contextualMeaningZh,
              sentence: input.sentence,
            },
          ],
          entryKey: "local-sustain",
          headword: "sustain",
        },
      ],
    };

    await expect(api.importLocal(batch, "batch-key", "s".repeat(43))).resolves.toMatchObject({
      entries: [{ entryKey: "local-sustain" }],
    });
    await expect(api.copy(input, "copy-key", "s".repeat(43))).rejects.toMatchObject({
      kind: "client-upgrade-required",
    });
  });
});

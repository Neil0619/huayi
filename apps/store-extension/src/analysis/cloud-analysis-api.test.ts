import { confirmCandidatesRequestSchema, contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import { createCloudAnalysisApi } from "./cloud-analysis-api.js";

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}

describe("Store Cloud analysis API", () => {
  it("authenticates only in the Worker request and parses shared SSE events", async () => {
    const encoded = new TextEncoder().encode(
      `event: analysis\nid: 1\ndata: ${JSON.stringify(contractFixtures.completedEvent)}\n\n`,
    );
    const split = encoded.findIndex((byte) => byte >= 0x80) + 1;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoded.slice(0, split));
            controller.enqueue(encoded.slice(split));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    const api = createCloudAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      clientVersion: "1.0.0",
      fetch,
      sessionToken: async () => "s".repeat(43),
    });

    await expect(
      collect(api.startAnalysis(contractFixtures.startAnalysisRequest, "request-key")),
    ).resolves.toEqual([contractFixtures.completedEvent]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit", method: "POST" });
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: `HuayiExtension ${"s".repeat(43)}`,
      "Idempotency-Key": "request-key",
      "X-Huayi-Client-Version": "1.0.0",
    });
  });

  it("consumes strict history and sends revision/idempotency proof with device auth", async () => {
    const archived = {
      ...contractFixtures.analysis,
      archivedAt: "2026-08-13T00:00:00.000Z",
      revision: 2,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ items: [contractFixtures.analysis], nextCursor: null }),
      )
      .mockResolvedValueOnce(Response.json(archived))
      .mockResolvedValueOnce(Response.json({ deleted: true, id: "analysis-1" }));
    const api = createCloudAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      clientVersion: "1.0.0",
      fetch,
      sessionToken: async () => "s".repeat(43),
    });

    await expect(api.listHistory({ archived: false, limit: 10 })).resolves.toMatchObject({
      items: [contractFixtures.analysis],
    });
    await expect(api.archiveAnalysis("analysis-1", 1, "archive-key")).resolves.toEqual(archived);
    await expect(api.deleteAnalysis("analysis-1", 2, "delete-key")).resolves.toEqual({
      deleted: true,
      id: "analysis-1",
    });
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: `HuayiExtension ${"s".repeat(43)}`,
      "Idempotency-Key": "archive-key",
      "If-Match": '"1"',
    });
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ credentials: "omit", method: "DELETE" });
  });

  it("gets detail and sends strict process and restore bodies", async () => {
    const processed = { ...contractFixtures.analysis, reviewState: "reviewed", revision: 2 };
    const restored = { ...processed, archivedAt: null, revision: 3 };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(contractFixtures.analysis))
      .mockResolvedValueOnce(Response.json(processed))
      .mockResolvedValueOnce(Response.json(restored));
    const api = createCloudAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      clientVersion: "1.0.0",
      fetch,
      sessionToken: async () => "s".repeat(43),
    });
    await expect(api.getAnalysis("analysis-1")).resolves.toEqual(contractFixtures.analysis);
    await expect(api.processNothingToSave("analysis-1", 1, "process-key")).resolves.toEqual(
      processed,
    );
    await expect(api.restoreAnalysis("analysis-1", 2, "restore-key")).resolves.toEqual(restored);
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ expectedRevision: 1, outcome: "nothing-to-save" }),
    );
  });

  it("confirms selected candidates with device, idempotency, and revision proof", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(contractFixtures.confirmCandidatesResponse));
    const api = createCloudAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      clientVersion: "1.0.0",
      fetch,
      sessionToken: async () => "s".repeat(43),
    });
    const request = confirmCandidatesRequestSchema.parse(
      JSON.parse(JSON.stringify(contractFixtures.confirmCandidatesRequest)),
    );
    await expect(api.confirmCandidates("analysis-1", request, "confirm-key")).resolves.toEqual(
      contractFixtures.confirmCandidatesResponse,
    );
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: `HuayiExtension ${"s".repeat(43)}`,
      "Idempotency-Key": "confirm-key",
      "If-Match": '"1"',
    });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/analyses/analysis-1/candidates:confirm");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(request);
  });
});

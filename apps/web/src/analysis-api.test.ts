import { confirmCandidatesRequestSchema, contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import { createWebAnalysisApi } from "./analysis-api.js";

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}

describe("Web analysis API", () => {
  it("consumes shared history and status contracts with Web credentials", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ items: [contractFixtures.analysis], nextCursor: null }),
      )
      .mockResolvedValueOnce(Response.json(contractFixtures.analysisRequestStatus));
    const api = createWebAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      csrfToken: async () => "csrf-token",
      fetch,
    });

    await expect(api.listPending()).resolves.toEqual({
      items: [contractFixtures.analysis],
      nextCursor: null,
    });
    await expect(api.getRequestStatus("request-1")).resolves.toEqual(
      contractFixtures.analysisRequestStatus,
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("reviewState=pendingReview");
  });

  it("streams shared analysis events across fragmented UTF-8 chunks", async () => {
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
        { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
      ),
    );
    const api = createWebAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      csrfToken: async () => "csrf-token",
      fetch,
    });

    await expect(
      collect(api.startAnalysis(contractFixtures.startAnalysisRequest, "request-key")),
    ).resolves.toEqual([contractFixtures.completedEvent]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "include", method: "POST" });
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-CSRF-Token": "csrf-token" });
  });

  it("passes cancellation only to the fixed authenticated SSE request", async () => {
    const abort = new AbortController();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("", { headers: { "Content-Type": "text/event-stream" } }));
    const api = createWebAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      csrfToken: async () => "csrf-token",
      fetch,
    });

    await collect(
      api.startAnalysis(contractFixtures.startAnalysisRequest, "request-key", abort.signal),
    );

    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      signal: abort.signal,
    });
  });

  it("preserves only a strict API error code when the SSE request is rejected", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(contractFixtures.error, { status: 429 }));
    const api = createWebAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      csrfToken: async () => "csrf-token",
      fetch,
    });

    await expect(
      collect(api.startAnalysis(contractFixtures.startAnalysisRequest, "request-key")),
    ).rejects.toEqual(expect.objectContaining({ code: "quota_exhausted" }));
  });

  it("uses strict history filters and revision/idempotency proof for history mutations", async () => {
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
    const api = createWebAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      csrfToken: async () => "csrf-token",
      fetch,
    });

    await expect(
      api.listHistory({
        archived: false,
        limit: 10,
        query: "100% value_",
        selectionKind: "passage",
        sourceType: "manual",
      }),
    ).resolves.toMatchObject({ items: [contractFixtures.analysis] });
    await expect(api.archiveAnalysis("analysis-1", 1, "archive-key")).resolves.toEqual(archived);
    await expect(api.deleteAnalysis("analysis-1", 2, "delete-key", true)).resolves.toEqual({
      deleted: true,
      id: "analysis-1",
    });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("query=100%25+value_");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ credentials: "include", method: "POST" });
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "archive-key",
      "If-Match": '"1"',
      "X-CSRF-Token": "csrf-token",
    });
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE" });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
      deleteStudyCapture: true,
      expectedRevision: 2,
    });
  });

  it("gets detail and sends strict process and restore bodies", async () => {
    const processed = { ...contractFixtures.analysis, reviewState: "reviewed", revision: 2 };
    const restored = { ...processed, archivedAt: null, revision: 3 };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(contractFixtures.analysis))
      .mockResolvedValueOnce(Response.json(processed))
      .mockResolvedValueOnce(Response.json(restored));
    const api = createWebAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      csrfToken: async () => "csrf-token",
      fetch,
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

  it("confirms selected candidates with CSRF, idempotency, and revision proof", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(contractFixtures.confirmCandidatesResponse));
    const api = createWebAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      csrfToken: async () => "csrf-token",
      fetch,
    });
    const request = confirmCandidatesRequestSchema.parse(
      JSON.parse(JSON.stringify(contractFixtures.confirmCandidatesRequest)),
    );
    await expect(api.confirmCandidates("analysis-1", request, "confirm-key")).resolves.toEqual(
      contractFixtures.confirmCandidatesResponse,
    );
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "confirm-key",
      "If-Match": '"1"',
      "X-CSRF-Token": "csrf-token",
    });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/analyses/analysis-1/candidates:confirm");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(request);
  });

  it("preserves only the strict stable API error code for candidate recovery", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "exact_duplicate",
            message: "A duplicate already exists.",
            requestId: "request-1",
          },
        },
        { status: 409 },
      ),
    );
    const api = createWebAnalysisApi({
      apiOrigin: "https://api.huayi.example",
      csrfToken: async () => "csrf-token",
      fetch,
    });
    const request = confirmCandidatesRequestSchema.parse(
      JSON.parse(JSON.stringify(contractFixtures.confirmCandidatesRequest)),
    );

    await expect(api.confirmCandidates("analysis-1", request, "confirm-key")).rejects.toEqual(
      expect.objectContaining({ code: "exact_duplicate" }),
    );
  });
});

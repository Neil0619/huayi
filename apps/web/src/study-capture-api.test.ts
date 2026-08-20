import { describe, expect, it, vi } from "vitest";

import { createWebStudyCaptureApi } from "./study-capture-api.js";

const capture = {
  captureCount: 1,
  createdAt: "2026-08-13T00:00:00.000Z",
  firstCapturedAt: "2026-08-13T00:00:00.000Z",
  id: "capture-1",
  kind: "sentence" as const,
  lastCapturedAt: "2026-08-13T00:00:00.000Z",
  normalizedTextHash: "a".repeat(64),
  revision: 1,
  sourceText: "This is worth learning.",
  status: "pending" as const,
  updatedAt: "2026-08-13T00:00:00.000Z",
};

describe("Web StudyCapture API", () => {
  it("uses Cookie GET filters and CSRF/revision proof for patch", async () => {
    const fetch = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json({ items: [{ capture, latestAnalysis: null }], nextCursor: null }),
      )
      .mockResolvedValueOnce(
        Response.json({ capture: { ...capture, revision: 2 }, latestAnalysis: null }),
      );
    const api = createWebStudyCaptureApi({
      apiOrigin: "https://api.huayi.example",
      csrfToken: async () => "csrf-token",
      fetch,
    });

    await api.listCaptures({ kind: "sentence", status: "pending" });
    await api.patchCapture("capture-1", { expectedRevision: 1, title: "Useful" }, "patch-key");

    const [listUrl, listInit] = fetch.mock.calls[0] ?? [];
    expect(new URL(String(listUrl)).searchParams.get("kind")).toBe("sentence");
    expect(listInit?.credentials).toBe("include");
    const [, patchInit] = fetch.mock.calls[1] ?? [];
    expect(patchInit).toMatchObject({ credentials: "include", method: "PATCH" });
    expect(patchInit?.headers).toMatchObject({
      "Idempotency-Key": "patch-key",
      "If-Match": '"1"',
      "X-CSRF-Token": "csrf-token",
    });
  });

  it("streams explicit capture analysis with revision, CSRF, and cancellation proof", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: analysis\ndata: {"requestId":"request-1","type":"analysis.started","unitCount":1}\nid: 1\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    );
    const api = createWebStudyCaptureApi({
      apiOrigin: "https://api.huayi.example",
      csrfToken: async () => "csrf-token",
      fetch,
    });
    const controller = new AbortController();
    const events = [];
    for await (const event of api.analyzeCapture(
      "capture-1",
      { expectedRevision: 1, intent: "initial" },
      "analysis-key",
      controller.signal,
    )) {
      events.push(event);
    }
    expect(events).toEqual([{ requestId: "request-1", type: "analysis.started", unitCount: 1 }]);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.huayi.example/v1/study-captures/capture-1/analyses:stream",
    );
    expect(init).toMatchObject({
      credentials: "include",
      method: "POST",
      signal: controller.signal,
    });
    expect(init?.headers).toMatchObject({
      "Idempotency-Key": "analysis-key",
      "If-Match": '"1"',
      "X-CSRF-Token": "csrf-token",
    });
  });
});

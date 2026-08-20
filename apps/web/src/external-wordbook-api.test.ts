import { describe, expect, it, vi } from "vitest";

import { createWebExternalWordbookApi } from "./external-wordbook-api.js";

const job = {
  createdAt: "2026-08-13T01:00:00.000Z",
  direction: "export",
  failedCount: 0,
  id: "10000000-0000-4000-8000-000000000001",
  lastErrorCode: null,
  nextPage: null,
  processedCount: 0,
  revision: 1,
  state: "pending",
  target: "eudic",
  totalCount: 1,
  updatedAt: "2026-08-13T01:00:00.000Z",
};

describe("Web external wordbook API", () => {
  it("lists with Cookie and creates with Cookie, CSRF and idempotency", async () => {
    const fetch = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [job], nextCursor: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify(job), { status: 201 }));
    const api = createWebExternalWordbookApi({
      apiOrigin: "https://api.huayi.invalid",
      csrfToken: async () => "c".repeat(32),
      fetch,
    });
    await api.listJobs({ direction: "export", target: "eudic" });
    await api.createJob({ direction: "export", target: "eudic" }, "create-1");

    expect(fetch.mock.calls[0]?.[0].toString()).toBe(
      "https://api.huayi.invalid/v1/wordbook-jobs?direction=export&target=eudic",
    );
    expect(fetch.mock.calls[0]?.[1]).toEqual({ credentials: "include" });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      credentials: "include",
      headers: expect.objectContaining({
        "idempotency-key": "create-1",
        "x-csrf-token": "c".repeat(32),
      }),
      method: "POST",
    });
  });

  it("binds retry and cancel to the resource revision", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ ...job, revision: 2 }));
    });
    const api = createWebExternalWordbookApi({
      apiOrigin: "https://api.huayi.invalid",
      csrfToken: async () => "c".repeat(32),
      fetch,
    });
    await api.retryJob(job.id, { expectedRevision: 1 }, "retry-1");
    await api.cancelJob(job.id, { expectedRevision: 1 }, "cancel-1");
    for (const call of fetch.mock.calls) {
      expect(call[1]).toMatchObject({
        headers: expect.objectContaining({ "if-match": '"1"' }),
        method: "POST",
      });
    }
    expect(fetch.mock.calls[0]?.[0].toString()).toContain(`/${job.id}/retry`);
    expect(fetch.mock.calls[1]?.[0].toString()).toContain(`/${job.id}/cancel`);
  });

  it("accepts only the fixed UTF-8 interoperability download headers", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response("accountable\nmake do\n", {
        headers: {
          "content-disposition": 'attachment; filename="huayi-words.txt"',
          "content-type": "text/plain; charset=utf-8",
        },
      });
    });
    const api = createWebExternalWordbookApi({
      apiOrigin: "https://api.huayi.invalid",
      csrfToken: async () => "c".repeat(32),
      fetch,
    });
    await expect(api.downloadWords()).resolves.toMatchObject({ filename: "huayi-words.txt" });
    expect(fetch.mock.calls[0]?.[0].toString()).toBe("https://api.huayi.invalid/v1/words:export");
    expect(fetch.mock.calls[0]?.[1]).toEqual({ credentials: "include" });
  });
});

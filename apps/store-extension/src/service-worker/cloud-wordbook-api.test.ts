import { describe, expect, it, vi } from "vitest";

import {
  CloudWordbookApiError,
  createCloudWordbookApi,
  shouldRetryCloudWordbookRequest,
} from "./cloud-wordbook-api.js";

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

describe("Cloud external wordbook API", () => {
  it("lists only through the fixed API origin with Extension authorization", async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ items: [job], nextCursor: null }), { status: 200 }),
    );
    const api = createCloudWordbookApi({
      apiOrigin: "https://api.huayi.invalid",
      clientVersion: "1.0.0",
      fetch,
    });

    await expect(
      api.list({ direction: "export", limit: 20, state: "pending" }, "s".repeat(43)),
    ).resolves.toMatchObject({ items: [{ id: job.id }] });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.huayi.invalid/v1/wordbook-jobs?direction=export&state=pending&limit=20",
    );
    expect(init).toMatchObject({
      credentials: "omit",
      headers: {
        Authorization: `HuayiExtension ${"s".repeat(43)}`,
        "X-Huayi-Client-Version": "1.0.0",
      },
    });
  });

  it("claims and settles a lease without exposing token data outside the caller", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entries: [
              {
                headword: "accountable",
                itemId: "20000000-0000-4000-8000-000000000001",
              },
            ],
            expiresAt: "2026-08-13T01:02:00.000Z",
            jobId: job.id,
            kind: "export",
            leaseToken: "l".repeat(43),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ job: { ...job, processedCount: 1, state: "completed" } }), {
          status: 200,
        }),
      );
    const api = createCloudWordbookApi({
      apiOrigin: "https://api.huayi.invalid",
      clientVersion: "1.0.0",
      fetch,
    });
    const session = "s".repeat(43);
    const lease = await api.lease(
      job.id,
      { claimNonce: "n".repeat(43), expectedRevision: 1 },
      session,
    );
    await expect(
      api.submit(
        job.id,
        {
          kind: "export",
          leaseToken: lease.leaseToken,
          receipts: [
            {
              itemId: "20000000-0000-4000-8000-000000000001",
              outcome: "created",
            },
          ],
        },
        "receipt-1",
        session,
      ),
    ).resolves.toMatchObject({ job: { state: "completed" } });
    expect(fetch.mock.calls[0]?.[0].toString()).toBe(
      `https://api.huayi.invalid/v1/wordbook-jobs/${job.id}/lease`,
    );
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "Idempotency-Key": "receipt-1" }),
    });
  });

  it("fails closed on invalid origins, sessions, and response bodies", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ items: [], owner: "leak" })));
    expect(() =>
      createCloudWordbookApi({
        apiOrigin: "http://api.huayi.invalid",
        clientVersion: "1.0.0",
        fetch,
      }),
    ).toThrow();
    const api = createCloudWordbookApi({
      apiOrigin: "https://api.huayi.invalid",
      clientVersion: "1.0.0",
      fetch,
    });
    await expect(api.list({}, "short")).rejects.toMatchObject({ kind: "authentication" });
    await expect(api.list({}, "s".repeat(43))).rejects.toMatchObject({ kind: "transient" });
  });

  it("retries only transient failures and an occupied lease", () => {
    expect(
      shouldRetryCloudWordbookRequest(new CloudWordbookApiError("transient", "network_error")),
    ).toBe(true);
    expect(
      shouldRetryCloudWordbookRequest(
        new CloudWordbookApiError("permanent", "wordbook_job_leased"),
      ),
    ).toBe(true);
    expect(
      shouldRetryCloudWordbookRequest(new CloudWordbookApiError("permanent", "invalid_request")),
    ).toBe(false);
    expect(shouldRetryCloudWordbookRequest(new Error("private detail"))).toBe(false);
  });
});

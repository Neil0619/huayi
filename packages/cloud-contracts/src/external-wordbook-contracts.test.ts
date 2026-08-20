import { describe, expect, it } from "vitest";

import {
  createWordbookJobRequestSchema,
  externalWordbookHttpRoutes,
  listWordbookJobsQuerySchema,
  submitWordbookReceiptsRequestSchema,
  wordbookJobListResponseSchema,
  wordbookJobResourceSchema,
  wordbookJobRevisionRequestSchema,
  wordbookLeaseRequestSchema,
  wordbookLeaseResponseSchema,
  wordbookReceiptResponseSchema,
} from "./external-wordbook-contracts.js";

const job = {
  createdAt: "2026-08-13T08:00:00.000Z",
  direction: "export" as const,
  failedCount: 0,
  id: "job-1",
  lastErrorCode: null,
  nextPage: null,
  processedCount: 1,
  revision: 3,
  state: "active" as const,
  target: "eudic" as const,
  totalCount: 2,
  updatedAt: "2026-08-13T08:02:00.000Z",
};

describe("external wordbook contracts", () => {
  it("keeps public jobs aggregate-only and fixes list and mutation routes", () => {
    expect(wordbookJobResourceSchema.parse(job)).toEqual(job);
    expect(() => wordbookJobResourceSchema.parse({ ...job, ownerUserId: "owner-1" })).toThrow();
    expect(() => wordbookJobResourceSchema.parse({ ...job, leaseToken: "secret" })).toThrow();
    expect(() =>
      wordbookJobResourceSchema.parse({ ...job, payload: { headword: "word" } }),
    ).toThrow();
    expect(wordbookJobListResponseSchema.parse({ items: [job], nextCursor: "cursor_1" })).toEqual({
      items: [job],
      nextCursor: "cursor_1",
    });
    expect(
      listWordbookJobsQuerySchema.parse({
        direction: "export",
        limit: "20",
        state: "failed",
        target: "shanbay",
      }),
    ).toEqual({ direction: "export", limit: 20, state: "failed", target: "shanbay" });

    expect(createWordbookJobRequestSchema.parse({ direction: "import", target: "eudic" })).toEqual({
      direction: "import",
      target: "eudic",
    });
    expect(() =>
      createWordbookJobRequestSchema.parse({ direction: "import", target: "shanbay" }),
    ).toThrow();
    expect(() =>
      createWordbookJobRequestSchema.parse({
        authorization: "secret",
        direction: "export",
        target: "eudic",
      }),
    ).toThrow();

    expect(externalWordbookHttpRoutes).toEqual({
      cancel: "/v1/wordbook-jobs/:id/cancel",
      create: "/v1/wordbook-jobs",
      detail: "/v1/wordbook-jobs/:id",
      lease: "/v1/wordbook-jobs/:id/lease",
      list: "/v1/wordbook-jobs",
      receipts: "/v1/wordbook-jobs/:id/receipts",
      retry: "/v1/wordbook-jobs/:id/retry",
    });
    expect(wordbookJobRevisionRequestSchema.parse({ expectedRevision: 3 })).toEqual({
      expectedRevision: 3,
    });
  });

  it("separates export batches from Eudic page leases without leaking authority", () => {
    const request = {
      claimNonce: "n".repeat(43),
      expectedRevision: 2,
    };
    expect(wordbookLeaseRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      wordbookLeaseRequestSchema.parse({ ...request, url: "https://evil.invalid" }),
    ).toThrow();

    const exportLease = {
      entries: [{ contextLine: "A bounded sentence.", headword: "accountable", itemId: "item-1" }],
      expiresAt: "2026-08-13T08:05:00.000Z",
      jobId: "job-1",
      kind: "export" as const,
      leaseToken: "t".repeat(43),
    };
    expect(wordbookLeaseResponseSchema.parse(exportLease)).toEqual(exportLease);
    expect(
      wordbookLeaseResponseSchema.parse({
        expiresAt: "2026-08-13T08:05:00.000Z",
        jobId: "job-2",
        kind: "eudic-import",
        leaseToken: "u".repeat(43),
        page: 4,
        pageSize: 100,
      }),
    ).toMatchObject({ kind: "eudic-import", page: 4, pageSize: 100 });
    expect(() =>
      wordbookLeaseResponseSchema.parse({ ...exportLease, apiOrigin: "secret" }),
    ).toThrow();
    expect(() =>
      wordbookLeaseResponseSchema.parse({
        ...exportLease,
        entries: Array(21).fill(exportLease.entries[0]),
      }),
    ).toThrow();
  });

  it("requires complete strict export receipts and bounded Eudic page outcomes", () => {
    const exportReceipts = {
      kind: "export" as const,
      leaseToken: "t".repeat(43),
      receipts: [
        { itemId: "item-1", outcome: "created" as const },
        { itemId: "item-2", outcome: "failed" as const, stableErrorCode: "network-error" as const },
      ],
    };
    expect(submitWordbookReceiptsRequestSchema.parse(exportReceipts)).toEqual(exportReceipts);
    expect(() =>
      submitWordbookReceiptsRequestSchema.parse({
        ...exportReceipts,
        receipts: [{ itemId: "item-1", outcome: "failed" }],
      }),
    ).toThrow();
    expect(() =>
      submitWordbookReceiptsRequestSchema.parse({
        ...exportReceipts,
        receipts: [exportReceipts.receipts[0], exportReceipts.receipts[0]],
      }),
    ).toThrow();

    const page = {
      entries: [
        {
          addedAt: "2026-08-12T03:00:00.000Z",
          contextLine: "A preserved remote context.",
          headword: "preserve",
        },
      ],
      kind: "eudic-import-page" as const,
      leaseToken: "u".repeat(43),
      page: 4,
    };
    expect(submitWordbookReceiptsRequestSchema.parse(page)).toEqual(page);
    expect(
      submitWordbookReceiptsRequestSchema.parse({
        kind: "eudic-import-failure",
        leaseToken: "u".repeat(43),
        page: 4,
        stableErrorCode: "rate-limited",
      }),
    ).toMatchObject({ kind: "eudic-import-failure", page: 4 });
    expect(() =>
      submitWordbookReceiptsRequestSchema.parse({ ...page, sourceType: "manual" }),
    ).toThrow();
    expect(wordbookReceiptResponseSchema.parse({ job })).toEqual({ job });
  });
});

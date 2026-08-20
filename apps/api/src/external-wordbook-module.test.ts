import { describe, expect, it, vi } from "vitest";

import {
  createExternalWordbookModule,
  type ExternalWordbookRepository,
} from "./external-wordbook-module.js";

const exportJob = {
  createdAt: "2026-08-13T08:00:00.000Z",
  direction: "export" as const,
  failedCount: 0,
  id: "job-1",
  lastErrorCode: null,
  nextPage: null,
  processedCount: 0,
  revision: 1,
  state: "pending" as const,
  target: "eudic" as const,
  totalCount: 2,
  updatedAt: "2026-08-13T08:00:00.000Z",
};

function repository(): ExternalWordbookRepository {
  return {
    cancel: vi.fn(async () => ({ ...exportJob, revision: 2, state: "cancelled" as const })),
    create: vi.fn(async () => exportJob),
    findById: vi.fn(async () => exportJob),
    lease: vi.fn(async () => ({
      entries: [{ contextLine: "A bounded sentence.", headword: "Accountable", itemId: "item-1" }],
      expiresAt: "2026-08-13T08:05:00.000Z",
      jobId: "job-1",
      kind: "export" as const,
    })),
    list: vi.fn(async () => ({ hasMore: false, items: [exportJob] })),
    retry: vi.fn(async () => ({ ...exportJob, revision: 2 })),
    submit: vi.fn(async () => ({ ...exportJob, processedCount: 1, revision: 2 })),
  };
}

function module(repositoryValue = repository()) {
  let id = 0;
  return {
    module: createExternalWordbookModule({
      cursorKey: new Uint8Array(32).fill(4),
      ids: () => `id-${++id}`,
      leaseDurationMs: 5 * 60 * 1_000,
      leaseKey: new Uint8Array(32).fill(8),
      now: () => new Date("2026-08-13T08:00:00.000Z"),
      repository: repositoryValue,
    }),
    repository: repositoryValue,
  };
}

describe("ExternalWordbookModule", () => {
  it("normalizes strict create/list inputs and binds idempotency to the job operation", async () => {
    const fixture = module();
    await expect(
      fixture.module.create("owner-1", "create-1", { direction: "export", target: "eudic" }),
    ).resolves.toEqual(exportJob);
    expect(fixture.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "create-1",
        jobId: "id-1",
        ownerUserId: "owner-1",
        request: { direction: "export", target: "eudic" },
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    await expect(
      fixture.module.list("owner-1", { direction: "export", limit: 20, target: "eudic" }),
    ).resolves.toEqual({ items: [exportJob], nextCursor: null });
    expect(fixture.repository.list).toHaveBeenCalledWith("owner-1", {
      direction: "export",
      limit: 20,
      target: "eudic",
    });
    await expect(
      fixture.module.create("owner-1", "create-2", { direction: "import", target: "shanbay" }),
    ).rejects.toThrow();
  });

  it("returns a deterministic signed lease and submits only its verified nonce hash", async () => {
    const fixture = module();
    const input = { claimNonce: "n".repeat(43), expectedRevision: 1 };
    const first = await fixture.module.lease("owner-1", "job-1", input);
    const second = await fixture.module.lease("owner-1", "job-1", input);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ kind: "export", leaseToken: expect.any(String) });
    expect(fixture.repository.lease).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 1,
        jobId: "job-1",
        nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        ownerUserId: "owner-1",
      }),
    );

    if (first.kind !== "export") throw new Error("Expected export lease.");
    await fixture.module.submit("owner-1", "job-1", "receipt-1", {
      kind: "export",
      leaseToken: first.leaseToken,
      receipts: [{ itemId: "item-1", outcome: "created" }],
    });
    expect(fixture.repository.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "receipt-1",
        jobId: "job-1",
        nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        ownerUserId: "owner-1",
        request: {
          kind: "export",
          receipts: [{ itemId: "item-1", outcome: "created" }],
        },
        tokenExpiresAt: "2026-08-13T08:05:00.000Z",
      }),
    );
    await expect(
      fixture.module.submit("owner-1", "another-job", "receipt-2", {
        kind: "export",
        leaseToken: first.leaseToken,
        receipts: [{ itemId: "item-1", outcome: "created" }],
      }),
    ).rejects.toMatchObject({ code: "wordbook_lease_stale" });
  });

  it("fixes Eudic authority and hashes imported contexts before the repository transaction", async () => {
    const repositoryValue = repository();
    repositoryValue.lease = vi.fn(async () => ({
      expiresAt: "2026-08-13T08:05:00.000Z",
      jobId: "job-1",
      kind: "eudic-import" as const,
      page: 0,
      pageSize: 100 as const,
    }));
    const fixture = module(repositoryValue);
    const lease = await fixture.module.lease("owner-1", "job-1", {
      claimNonce: "q".repeat(43),
      expectedRevision: 1,
    });
    if (lease.kind !== "eudic-import") throw new Error("Expected import lease.");
    await fixture.module.submit("owner-1", "job-1", "receipt-import", {
      entries: [
        {
          addedAt: "2026-08-12T03:00:00.000Z",
          contextLine: "A preserved context.",
          headword: "  Accountable  ",
        },
      ],
      kind: "eudic-import-page",
      leaseToken: lease.leaseToken,
      page: 0,
    });
    expect(fixture.repository.submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        importEntries: [
          expect.objectContaining({
            canonicalKey: "accountable",
            contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
            observedAt: "2026-08-12T03:00:00.000Z",
            sourceType: "eudic",
          }),
        ],
        request: expect.objectContaining({ kind: "eudic-import-page", page: 0 }),
      }),
    );
  });
});

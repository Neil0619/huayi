import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";
import { createExternalWordbookApp } from "./external-wordbook-app.js";
import {
  createExternalWordbookModule,
  type ExternalWordbookRepository,
} from "./external-wordbook-module.js";

const job = {
  createdAt: "2026-08-13T01:00:00.000Z",
  direction: "export" as const,
  failedCount: 0,
  id: "10000000-0000-4000-8000-000000000001",
  lastErrorCode: null,
  nextPage: null,
  processedCount: 0,
  revision: 1,
  state: "pending" as const,
  target: "eudic" as const,
  totalCount: 1,
  updatedAt: "2026-08-13T01:00:00.000Z",
};

function server() {
  const repository: ExternalWordbookRepository = {
    cancel: vi.fn(async () => ({ ...job, revision: 2, state: "cancelled" as const })),
    create: vi.fn(async () => job),
    findById: vi.fn(async (_owner, id) => (id === job.id ? job : null)),
    lease: vi.fn(async () => ({
      entries: [
        {
          headword: "accountable",
          itemId: "20000000-0000-4000-8000-000000000001",
        },
      ],
      expiresAt: "2026-08-13T01:02:00.000Z",
      jobId: job.id,
      kind: "export" as const,
    })),
    list: vi.fn(async () => ({ hasMore: false, items: [job] })),
    retry: vi.fn(async () => ({ ...job, revision: 2 })),
    submit: vi.fn(async () => ({ ...job, processedCount: 1, state: "completed" as const })),
  };
  const inner = createExternalWordbookApp({
    authenticate: (context) => ({
      kind: context.req.header("authorization") === undefined ? "web" : "extension",
      userId: "user-1",
    }),
    module: createExternalWordbookModule({
      cursorKey: Buffer.alloc(32, 1),
      ids: () => job.id,
      leaseDurationMs: 120_000,
      leaseKey: Buffer.alloc(32, 2),
      now: () => new Date("2026-08-13T01:00:00.000Z"),
      repository,
    }),
  });
  const outer = new Hono();
  outer.onError((error, context) => {
    const fault =
      error instanceof CloudFault
        ? error
        : new CloudFault("invalid_request", "The request could not be completed.");
    return context.json(
      { error: { code: fault.code, message: fault.message, requestId: "request-1" } },
      errorStatus(fault.code),
    );
  });
  outer.route("/", inner);
  return { outer, repository };
}

describe("external wordbook job HTTP", () => {
  it("allows Web list/create but reserves leasing for the paired Extension", async () => {
    const { outer } = server();
    expect((await outer.request("/v1/wordbook-jobs?target=eudic")).status).toBe(200);
    const created = await outer.request("/v1/wordbook-jobs", {
      body: JSON.stringify({ direction: "export", target: "eudic" }),
      headers: { "content-type": "application/json", "idempotency-key": "create-1" },
      method: "POST",
    });
    expect(created.status).toBe(201);

    const webLease = await outer.request(`/v1/wordbook-jobs/${job.id}/lease`, {
      body: JSON.stringify({ claimNonce: "n".repeat(43), expectedRevision: 1 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(webLease.status).toBe(403);
    const extensionLease = await outer.request(`/v1/wordbook-jobs/${job.id}/lease`, {
      body: JSON.stringify({ claimNonce: "n".repeat(43), expectedRevision: 1 }),
      headers: {
        authorization: "HuayiExtension device-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(extensionLease.status).toBe(200);
    expect(await extensionLease.json()).toMatchObject({
      kind: "export",
      leaseToken: expect.any(String),
    });
  });

  it("validates strict receipt and revision write headers", async () => {
    const { outer, repository } = server();
    const lease = await outer.request(`/v1/wordbook-jobs/${job.id}/lease`, {
      body: JSON.stringify({ claimNonce: "n".repeat(43), expectedRevision: 1 }),
      headers: {
        authorization: "HuayiExtension device-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    const leaseBody = (await lease.json()) as { leaseToken: string };
    const receipt = await outer.request(`/v1/wordbook-jobs/${job.id}/receipts`, {
      body: JSON.stringify({
        kind: "export",
        leaseToken: leaseBody.leaseToken,
        receipts: [{ itemId: "20000000-0000-4000-8000-000000000001", outcome: "created" }],
      }),
      headers: {
        authorization: "HuayiExtension device-token",
        "content-type": "application/json",
        "idempotency-key": "receipt-1",
      },
      method: "POST",
    });
    expect(receipt.status).toBe(200);
    expect(repository.submit).toHaveBeenCalledOnce();

    const mismatch = await outer.request(`/v1/wordbook-jobs/${job.id}/cancel`, {
      body: JSON.stringify({ expectedRevision: 1 }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "cancel-1",
        "if-match": '"2"',
      },
      method: "POST",
    });
    expect(mismatch.status).toBe(400);
  });
});

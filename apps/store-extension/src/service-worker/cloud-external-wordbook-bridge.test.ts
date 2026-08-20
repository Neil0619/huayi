import { describe, expect, it, vi } from "vitest";

import type { CloudWordbookApi } from "./cloud-wordbook-api.js";
import { createCloudExternalWordbookBridge } from "./cloud-external-wordbook-bridge.js";

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

function api(overrides: Partial<CloudWordbookApi> = {}): CloudWordbookApi {
  return {
    create: vi.fn(async () => job),
    lease: vi.fn(async () => ({
      entries: [
        {
          contextLine: "An accountable decision.",
          headword: "accountable",
          itemId: "20000000-0000-4000-8000-000000000001",
        },
      ],
      expiresAt: "2026-08-13T01:05:00.000Z",
      jobId: job.id,
      kind: "export" as const,
      leaseToken: "l".repeat(43),
    })),
    list: vi.fn(async () => ({ items: [job], nextCursor: null })),
    submit: vi.fn(async () => ({
      job: { ...job, processedCount: 1, state: "completed" as const },
    })),
    update: vi.fn(async () => ({ ...job, state: "cancelled" as const })),
    ...overrides,
  };
}

function bridge(cloud: CloudWordbookApi, overrides: Record<string, unknown> = {}) {
  return createCloudExternalWordbookBridge({
    allowTarget: async () => true,
    api: cloud,
    eudic: {
      addWord: vi.fn(async () => "created" as const),
      listWords: vi.fn(async () => []),
    },
    idempotencyKey: () => "idempotency-1",
    randomNonce: () => "n".repeat(43),
    session: async () => ({
      expiresAt: "2099-08-14T00:00:00.000Z",
      preferences: {
        cloudWordCopyMode: "enabled",
        extensionQueryModelMode: "platform",
        revision: 1,
        studyCaptureMode: "manual",
        updatedAt: "2026-08-13T00:00:00.000Z",
      },
      token: "s".repeat(43),
    }),
    ...overrides,
  });
}

describe("Cloud external wordbook bridge", () => {
  it("executes one Eudic export lease and submits an exact stable receipt", async () => {
    const cloud = api();
    const eudic = {
      addWord: vi.fn(async () => "created" as const),
      listWords: vi.fn(async () => []),
    };
    const worker = bridge(cloud, { eudic });
    await expect(worker.processOne()).resolves.toBe(true);
    expect(eudic.addWord).toHaveBeenCalledWith(
      "accountable",
      "An accountable decision.",
      expect.any(AbortSignal),
    );
    expect(cloud.submit).toHaveBeenCalledWith(
      job.id,
      {
        kind: "export",
        leaseToken: "l".repeat(43),
        receipts: [{ itemId: "20000000-0000-4000-8000-000000000001", outcome: "created" }],
      },
      "idempotency-1",
      "s".repeat(43),
    );
    expect(cloud.list).toHaveBeenCalledWith({ limit: 20 }, "s".repeat(43));
  });

  it("reconsiders an active Eudic job so an expired server lease can be reclaimed", async () => {
    const activeJob = { ...job, revision: 2, state: "active" as const };
    const cloud = api({
      list: vi.fn(async () => ({ items: [activeJob], nextCursor: null })),
    });

    await expect(bridge(cloud).processOne()).resolves.toBe(true);
    expect(cloud.lease).toHaveBeenCalledWith(
      activeJob.id,
      { claimNonce: "n".repeat(43), expectedRevision: 2 },
      "s".repeat(43),
    );
  });

  it("submits a strict Eudic import page without writing the local lexicon", async () => {
    const cloud = api({
      lease: vi.fn(async () => ({
        expiresAt: "2026-08-13T01:05:00.000Z",
        jobId: job.id,
        kind: "eudic-import" as const,
        leaseToken: "l".repeat(43),
        page: 0,
        pageSize: 100 as const,
      })),
      list: vi.fn(async () => ({
        items: [
          {
            ...job,
            direction: "import" as const,
            nextPage: 0,
            target: "eudic" as const,
            totalCount: null,
          },
        ],
        nextCursor: null,
      })),
    });
    const eudic = {
      addWord: vi.fn(async () => "created" as const),
      listWords: vi.fn(async () => [
        { addedAt: "2026-08-12T00:00:00.000Z", contextLine: "Use it.", headword: "make do" },
      ]),
    };
    await bridge(cloud, { eudic }).processOne();
    expect(cloud.submit).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({
        entries: [
          { addedAt: "2026-08-12T00:00:00.000Z", contextLine: "Use it.", headword: "make do" },
        ],
        kind: "eudic-import-page",
        page: 0,
      }),
      "idempotency-1",
      "s".repeat(43),
    );
  });

  it("fails closed before cloud or recipient access when unpaired or consent is off", async () => {
    const cloud = api();
    await expect(bridge(cloud, { session: async () => null }).processOne()).resolves.toBe(false);
    await expect(bridge(cloud, { allowTarget: async () => false }).processOne()).resolves.toBe(
      false,
    );
    expect(cloud.lease).not.toHaveBeenCalled();
  });
});

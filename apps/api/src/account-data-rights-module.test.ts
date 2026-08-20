import { describe, expect, it, vi } from "vitest";

import {
  createAccountDataRightsModule,
  type AccountDataRightsRepository,
} from "./account-data-rights-module.js";

const pending = {
  createdAt: "2026-08-13T01:00:00.000Z",
  formatVersion: 1 as const,
  id: "10000000-0000-4000-8000-000000000001",
  revision: 1,
  state: "pending" as const,
  updatedAt: "2026-08-13T01:00:00.000Z",
};

function repository(): AccountDataRightsRepository {
  return {
    currentExport: vi.fn(async () => pending),
    exportDownload: vi.fn(async () => ({
      expiresAt: "2026-08-14T01:00:00.000Z",
      objectKey: "account-exports/10000000-0000-4000-8000-000000000001.ndjson",
    })),
    requestDeletion: vi.fn(async () => ({
      accepted: true as const,
      requestedAt: "2026-08-13T01:00:00.000Z",
    })),
    replayDeletion: vi.fn(async () => null),
    requestExport: vi.fn(async () => pending),
    retryExport: vi.fn(async () => ({ ...pending, revision: 2 })),
  };
}

describe("account data rights module", () => {
  it("binds idempotency hashes to each export operation and validates resources", async () => {
    const store = repository();
    const module = createAccountDataRightsModule({
      now: () => new Date("2026-08-13T01:00:00.000Z"),
      repository: store,
      signedUrls: { create: vi.fn() },
    });

    await expect(module.requestExport("user-1", "create-key", {})).resolves.toEqual(pending);
    await expect(
      module.retryExport("user-1", pending.id, "retry-key", { expectedRevision: 1 }),
    ).resolves.toMatchObject({ revision: 2 });
    expect(store.requestExport).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "create-key",
        ownerUserId: "user-1",
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
    expect(store.retryExport).toHaveBeenCalledWith(
      expect.objectContaining({
        exportId: pending.id,
        expectedRevision: 1,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
  });

  it("signs only ready owned objects for at most fifteen minutes", async () => {
    const store = repository();
    const create = vi.fn(async (_key: string, seconds: number) => ({
      url: "https://project.supabase.co/storage/v1/object/sign/private/export?token=opaque",
      validForSeconds: seconds,
    }));
    const module = createAccountDataRightsModule({
      now: () => new Date("2026-08-13T01:00:00.000Z"),
      repository: store,
      signedUrls: { create },
    });

    await expect(
      module.createDownload("user-1", pending.id, new Date("2026-08-13T00:50:01.000Z")),
    ).resolves.toEqual({
      expiresAt: "2026-08-13T01:15:00.000Z",
      url: "https://project.supabase.co/storage/v1/object/sign/private/export?token=opaque",
    });
    expect(create).toHaveBeenCalledWith(expect.any(String), 900);
    await expect(
      module.createDownload("user-1", pending.id, new Date("2026-08-13T00:44:59.000Z")),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("passes only the fixed deletion confirmation into the durable request", async () => {
    const store = repository();
    const module = createAccountDataRightsModule({
      now: () => new Date("2026-08-13T01:00:00.000Z"),
      repository: store,
      signedUrls: { create: vi.fn() },
    });

    await expect(
      module.requestDeletion(
        "user-1",
        "delete-key",
        "session-proof-hash",
        new Date("2026-08-13T00:59:00.000Z"),
        { confirmation: "delete-account" },
      ),
    ).resolves.toEqual({ accepted: true, requestedAt: "2026-08-13T01:00:00.000Z" });
    expect(store.requestDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmation: "delete-account",
        idempotencyKey: "delete-key",
        ownerUserId: "user-1",
        requestSessionHash: "session-proof-hash",
      }),
    );
  });
});

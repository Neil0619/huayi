import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createAccountDataRightsWorker,
  type AccountDataRightsWorkerRepository,
} from "./account-data-rights-worker.js";

describe("account data rights worker", () => {
  it("strictly serializes one claimed owner snapshot and publishes only after upload", async () => {
    const content: Uint8Array[] = [];
    const repository: AccountDataRightsWorkerRepository = {
      claimDeletion: vi.fn(async () => null),
      claimExport: vi.fn(async () => ({
        exportId: "export-1",
        leaseToken: "lease-1",
        objectKey: "account-exports/export-1.ndjson",
        ownerUserId: "user-1",
      })),
      completeExport: vi.fn(async () => true),
      failDeletion: vi.fn(),
      failExport: vi.fn(),
      finishAuthDeletion: vi.fn(),
      finishDatabaseDeletion: vi.fn(),
      finishExportDeletion: vi.fn(),
    };
    const worker = createAccountDataRightsWorker({
      authority: {
        deleteAuthUser: vi.fn(),
        deleteObjects: vi.fn(),
        upload: vi.fn(async (_key, body) => {
          content.push(body);
        }),
      },
      exportSource: {
        records: vi.fn(async () => [
          {
            cloudWordCopyMode: "enabled" as const,
            createdAt: "2026-08-12T01:00:00.000Z",
            dailyGoal: 5,
            extensionQueryModelMode: "platform" as const,
            recordType: "account-preferences" as const,
            revision: 1,
            studyCaptureMode: "manual" as const,
            timezone: "UTC",
            updatedAt: "2026-08-12T01:00:00.000Z",
          },
        ]),
      },
      now: () => new Date("2026-08-13T01:00:00.000Z"),
      repository,
    });

    await expect(worker.runOne()).resolves.toEqual({ deletion: "idle", export: "processed" });
    const bytes = content[0];
    if (bytes === undefined) throw new Error("Expected uploaded bytes.");
    const text = new TextDecoder().decode(bytes);
    expect(text.endsWith("\n")).toBe(true);
    expect(
      text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    ).toEqual([
      {
        exportedAt: "2026-08-13T01:00:00.000Z",
        product: "huayi-cloud",
        recordType: "manifest",
        schemaVersion: 1,
      },
      {
        cloudWordCopyMode: "enabled",
        createdAt: "2026-08-12T01:00:00.000Z",
        dailyGoal: 5,
        extensionQueryModelMode: "platform",
        recordType: "account-preferences",
        revision: 1,
        studyCaptureMode: "manual",
        timezone: "UTC",
        updatedAt: "2026-08-12T01:00:00.000Z",
      },
    ]);
    expect(repository.completeExport).toHaveBeenCalledWith(
      expect.objectContaining({
        byteLength: bytes.byteLength,
        recordCount: 2,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
  });

  it("advances deletion in fixed object, database, and Auth order", async () => {
    const calls: string[] = [];
    const repository: AccountDataRightsWorkerRepository = {
      claimDeletion: vi.fn(async () => ({
        exportObjectKeys: ["account-exports/export-1.ndjson"],
        jobId: "deletion-1",
        leaseToken: "lease-1",
        stage: "requested" as const,
        subjectUserId: "user-1",
      })),
      claimExport: vi.fn(async () => null),
      completeExport: vi.fn(),
      failDeletion: vi.fn(),
      failExport: vi.fn(),
      finishAuthDeletion: vi.fn(async () => {
        calls.push("completed");
      }),
      finishDatabaseDeletion: vi.fn(async () => {
        calls.push("database");
      }),
      finishExportDeletion: vi.fn(async () => {
        calls.push("exports");
      }),
    };
    const worker = createAccountDataRightsWorker({
      authority: {
        deleteAuthUser: vi.fn(async () => {
          calls.push("auth");
        }),
        deleteObjects: vi.fn(async () => {
          calls.push("objects");
        }),
        upload: vi.fn(),
      },
      exportSource: { records: vi.fn() },
      now: () => new Date("2026-08-13T01:00:00.000Z"),
      repository,
    });

    await expect(worker.runOne()).resolves.toEqual({ deletion: "processed", export: "idle" });
    expect(calls).toEqual(["objects", "exports", "database", "auth", "completed"]);
  });
});

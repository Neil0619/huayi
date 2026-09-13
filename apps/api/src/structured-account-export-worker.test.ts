import { createHash } from "node:crypto";
import {
  accountDataExportRecordReadSchema,
  accountDataExportRecordSchema,
  accountDataExportRecordV2Schema,
  accountDataExportRecordV3Schema,
  accountDataExportRecordV4Schema,
} from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";
import { createAccountDataRightsWorker } from "./account-data-rights-worker.js";
import { structuredAnalysisFixture } from "./test-support/structured-analysis-fixture.js";
import { structuredQueryFixture } from "./test-support/structured-query-fixture.js";

describe("versioned account export serialization", () => {
  it("rejects an extra source manifest before publication", async () => {
    const upload = vi.fn();
    const failExport = vi.fn();
    const completeExport = vi.fn();
    const worker = createAccountDataRightsWorker({
      now: () => new Date("2026-09-12T11:00:00Z"),
      exportSource: {
        records: async () => [
          {
            recordType: "manifest",
            schemaVersion: 1,
            product: "huayi-cloud",
            exportedAt: "2026-09-12T10:00:00Z",
          },
        ],
      },
      authority: { upload, deleteAuthUser: vi.fn(), deleteObjects: vi.fn() },
      repository: {
        prepareExportUpload: vi.fn(async () => undefined),
        reconcileExportPublication: vi.fn(async () => "retired" as const),
        claimExport: async () => ({
          formatVersion: 2,
          exportId: "export-1",
          ownerUserId: "owner",
          leaseToken: "lease",
          objectKey: "account-exports/export-1.ndjson",
        }),
        claimDeletion: async () => null,
        completeExport,
        failExport,
        failDeletion: vi.fn(),
        finishAuthDeletion: vi.fn(),
        finishDatabaseDeletion: vi.fn(),
        finishExportDeletion: vi.fn(),
      },
    });
    expect(await worker.runOne()).toEqual({ deletion: "idle", export: "failed" });
    expect(failExport).toHaveBeenCalledWith({
      exportId: "export-1",
      leaseToken: "lease",
      errorCode: "export-build-failed",
    });
    expect(upload).not.toHaveBeenCalled();
    expect(completeExport).not.toHaveBeenCalled();
  });
  it.each([1, 2, 3, 4] as const)(
    "pins the NDJSON manifest and each record to stored format %s",
    async (formatVersion) => {
      const analysis = { recordType: "analysis" as const, analysis: structuredAnalysisFixture() };
      const query = {
        recordType: "extension-query-generation" as const,
        id: "generation-1",
        state: "completed" as const,
        action: "explain" as const,
        selectionKind: "sentence" as const,
        sourceText: "We can.",
        sourceType: "web-selection" as const,
        outputContract: "structured-teaching-v1" as const,
        result: structuredQueryFixture(),
        createdAt: "2026-09-12T10:00:00Z",
        expiresAt: "2026-09-13T10:00:00Z",
      };
      const records = [analysis, query].map((value) =>
        accountDataExportRecordReadSchema.parse(value),
      );
      const upload = vi.fn<(key: string, content: Uint8Array) => Promise<void>>(
        async () => undefined,
      );
      const completeExport = vi.fn(async () => true);
      const failExport = vi.fn();
      const worker = createAccountDataRightsWorker({
        now: () => new Date("2026-09-12T11:00:00Z"),
        exportSource: { records: async () => records },
        authority: { upload, deleteAuthUser: vi.fn(), deleteObjects: vi.fn() },
        repository: {
          prepareExportUpload: vi.fn(async () => undefined),
          reconcileExportPublication: vi.fn(async () => "retired" as const),
          claimExport: async () => ({
            formatVersion,
            exportId: "export-1",
            ownerUserId: "owner",
            leaseToken: "secret-lease",
            objectKey: "account-exports/export-1.ndjson",
          }),
          claimDeletion: async () => null,
          completeExport,
          failExport,
          failDeletion: vi.fn(),
          finishAuthDeletion: vi.fn(),
          finishDatabaseDeletion: vi.fn(),
          finishExportDeletion: vi.fn(),
        },
      });
      expect(await worker.runOne()).toEqual({ deletion: "idle", export: "processed" });
      const bytes = upload.mock.calls[0]?.[1];
      if (!bytes) throw new Error("Expected uploaded bytes");
      const raw = new TextDecoder().decode(bytes);
      const exported = raw
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown);
      const schema =
        formatVersion === 1
          ? accountDataExportRecordSchema
          : formatVersion === 2
            ? accountDataExportRecordV2Schema
            : formatVersion === 3
              ? accountDataExportRecordV3Schema
              : accountDataExportRecordV4Schema;
      exported.forEach((record) => schema.parse(record));
      expect(exported[0]).toMatchObject({ recordType: "manifest", schemaVersion: formatVersion });
      if (formatVersion !== 1) expect(exported.slice(1)).toEqual(records);
      else {
        expect(exported[1]).toMatchObject({
          analysis: {
            modelMetadata: analysis.analysis.modelMetadata,
            result: { type: "sentence-passage-analysis-v2" },
          },
        });
        expect(exported[2]).toMatchObject({ result: { type: "explain-sentence" } });
        expect(exported[2]).not.toHaveProperty("outputContract");
      }
      expect(raw).not.toContain("secret-lease");
      expect(completeExport).toHaveBeenCalledWith(
        expect.objectContaining({
          byteLength: bytes.byteLength,
          recordCount: 3,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        }),
      );
      expect(failExport).not.toHaveBeenCalled();
    },
  );
});

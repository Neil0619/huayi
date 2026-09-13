import { describe, expect, it } from "vitest";
import {
  accountDataExportJobResourceSchema,
  accountDataExportRecordSchema,
  createAccountDataExportRequestSchema,
  retryAccountDataExportRequestSchema,
} from "./account-data-rights-contracts.js";
import {
  accountDataExportFormatRequestSchema,
  accountDataExportJobReadResourceSchema,
  accountDataExportRecordV2Schema,
  projectAccountDataExportRecordForLegacy,
  retryAccountDataExportReadRequestSchema,
} from "./structured-account-export.js";

const now = "2026-09-12T10:00:00Z";
const manifest = {
  recordType: "manifest",
  product: "huayi-cloud",
  exportedAt: now,
  schemaVersion: 2,
};
const common = { id: "export-id", createdAt: now, updatedAt: now, revision: 1 };

describe("explicit account export format", () => {
  it("keeps missing format unchanged for old request hashing and freezes old request schemas", () => {
    expect(accountDataExportFormatRequestSchema.parse({})).toEqual({});
    expect(retryAccountDataExportReadRequestSchema.parse({ expectedRevision: 1 })).toEqual({
      expectedRevision: 1,
    });
    for (const formatVersion of [1, 2]) {
      expect(accountDataExportFormatRequestSchema.parse({ formatVersion })).toEqual({
        formatVersion,
      });
      expect(
        retryAccountDataExportReadRequestSchema.parse({ formatVersion, expectedRevision: 1 }),
      ).toEqual({ formatVersion, expectedRevision: 1 });
      expect(() => createAccountDataExportRequestSchema.parse({ formatVersion })).toThrow();
      expect(() =>
        retryAccountDataExportRequestSchema.parse({ formatVersion, expectedRevision: 1 }),
      ).toThrow();
    }
    for (const input of [
      { formatVersion: 4 },
      { formatVersion: "2" },
      { formatVersion: null },
      { formatVersion: 2, ownerUserId: "another-owner" },
    ])
      expect(() => accountDataExportFormatRequestSchema.parse(input)).toThrow();
  });

  it("adds format 2 to all public job states without exposing worker or object authority", () => {
    for (const state of [
      { state: "pending" },
      { state: "running" },
      { state: "ready", expiresAt: now, byteLength: 1, recordCount: 1 },
      { state: "failed", stableErrorCode: "export-build-failed" },
      { state: "expired", expiresAt: now },
    ]) {
      const native = { ...common, ...state, formatVersion: 2 };
      expect(accountDataExportJobReadResourceSchema.parse(native)).toEqual(native);
      expect(() => accountDataExportJobResourceSchema.parse(native)).toThrow();
      const legacy = { ...native, formatVersion: 1 };
      expect(accountDataExportJobResourceSchema.parse(legacy)).toEqual(legacy);
      for (const injected of [
        { objectKey: "secret-path" },
        { leaseToken: "secret" },
        { ownerUserId: "foreign" },
      ])
        expect(() =>
          accountDataExportJobReadResourceSchema.parse({ ...native, ...injected }),
        ).toThrow();
    }
  });

  it("uses an explicit native manifest and keeps its legacy projection valid and stable", () => {
    expect(accountDataExportRecordV2Schema.parse(manifest)).toEqual(manifest);
    expect(() => accountDataExportRecordSchema.parse(manifest)).toThrow();
    const old = projectAccountDataExportRecordForLegacy(
      accountDataExportRecordV2Schema.parse(manifest),
    );
    expect(old).toEqual({ ...manifest, schemaVersion: 1 });
    expect(accountDataExportRecordSchema.parse(old)).toEqual(old);
    expect(projectAccountDataExportRecordForLegacy(old)).toEqual(old);
    expect(() => accountDataExportRecordV2Schema.parse(old)).toThrow();
    expect(() =>
      accountDataExportRecordV2Schema.parse({ ...manifest, credential: "secret" }),
    ).toThrow();
  });
});

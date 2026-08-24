import { describe, expect, it } from "vitest";

import {
  accountDataExportJobResourceSchema,
  accountDataExportRecordSchema,
  accountDataRightsHttpRoutes,
  accountDeletionRequestSchema,
  accountDeletionResponseSchema,
  createAccountDataExportRequestSchema,
  contractFixtures,
  csrfTokenResponseSchema,
  dataRightsWorkerResponseSchema,
  downloadAccountDataExportResponseSchema,
  identityHttpRoutes,
  passwordLoginResponseSchema,
  retryAccountDataExportRequestSchema,
} from "./index.js";

const timestamps = {
  createdAt: "2026-08-13T01:00:00.000Z",
  updatedAt: "2026-08-13T01:00:00.000Z",
};

describe("account data rights contracts", () => {
  it("publishes strict fixed routes, session access, and mutation requests", () => {
    expect(accountDataRightsHttpRoutes).toEqual({
      createExport: "/v1/account-data-exports",
      currentExport: "/v1/account-data-exports/current",
      deleteAccount: "/v1/account-deletion",
      downloadExport: "/v1/account-data-exports/:id/download-url",
      retryExport: "/v1/account-data-exports/:id/retry",
      runWorker: "/internal/data-rights/run",
    });
    expect(identityHttpRoutes.googleLoginStart).toBe("/v1/auth/google/login/start");
    expect(identityHttpRoutes.logout).toBe("/v1/auth/logout");
    expect(createAccountDataExportRequestSchema.parse({})).toEqual({});
    expect(retryAccountDataExportRequestSchema.parse({ expectedRevision: 2 })).toEqual({
      expectedRevision: 2,
    });
    expect(accountDeletionRequestSchema.parse({ confirmation: "delete-account" })).toEqual({
      confirmation: "delete-account",
    });
    expect(() => accountDeletionRequestSchema.parse({ confirmation: "删除我的账号" })).toThrow();
    expect(
      csrfTokenResponseSchema.parse({ access: "data-rights", csrfToken: "c".repeat(43) }),
    ).toEqual({ access: "data-rights", csrfToken: "c".repeat(43) });
    expect(
      passwordLoginResponseSchema.parse({ access: "full", csrfToken: "c".repeat(43) }),
    ).toEqual({ access: "full", csrfToken: "c".repeat(43) });
  });

  it("enforces state-specific export resources and bounded safe worker responses", () => {
    expect(
      accountDataExportJobResourceSchema.parse({
        ...timestamps,
        formatVersion: 1,
        id: "export-1",
        revision: 1,
        state: "pending",
      }),
    ).toBeTruthy();
    expect(
      accountDataExportJobResourceSchema.parse({
        ...timestamps,
        byteLength: 128,
        expiresAt: "2026-08-14T01:00:00.000Z",
        formatVersion: 1,
        id: "export-1",
        recordCount: 4,
        revision: 2,
        state: "ready",
      }),
    ).toBeTruthy();
    expect(() =>
      accountDataExportJobResourceSchema.parse({
        ...timestamps,
        formatVersion: 1,
        id: "export-1",
        revision: 2,
        state: "ready",
      }),
    ).toThrow();
    expect(() =>
      accountDataExportJobResourceSchema.parse({
        ...timestamps,
        formatVersion: 1,
        id: "export-1",
        objectKey: "private/export-1",
        revision: 2,
        state: "failed",
        stableErrorCode: "object-write-failed",
      }),
    ).toThrow();
    expect(dataRightsWorkerResponseSchema.parse({ deletion: "idle", export: "processed" })).toEqual(
      { deletion: "idle", export: "processed" },
    );
    expect(() =>
      dataRightsWorkerResponseSchema.parse({ deletion: "idle", export: "failed", userId: "x" }),
    ).toThrow();
  });

  it("accepts only owned HTTPS signed URLs and fixed deletion receipts", () => {
    expect(
      downloadAccountDataExportResponseSchema.parse({
        expiresAt: "2026-08-13T01:15:00.000Z",
        url: "https://project.supabase.co/storage/v1/object/sign/private/export-1?token=opaque",
      }),
    ).toBeTruthy();
    for (const url of [
      "http://project.supabase.co/private/export-1",
      "https://user:pass@project.supabase.co/private/export-1",
    ]) {
      expect(() =>
        downloadAccountDataExportResponseSchema.parse({
          expiresAt: "2026-08-13T01:15:00.000Z",
          url,
        }),
      ).toThrow();
    }
    expect(
      accountDeletionResponseSchema.parse({
        accepted: true,
        requestedAt: "2026-08-13T01:00:00.000Z",
      }),
    ).toEqual({ accepted: true, requestedAt: "2026-08-13T01:00:00.000Z" });
  });

  it("exports the strict eight-record account snapshot without authority fields", () => {
    expect(
      accountDataExportRecordSchema.parse({
        exportedAt: "2026-08-13T01:00:00.000Z",
        product: "huayi-cloud",
        recordType: "manifest",
        schemaVersion: 1,
      }),
    ).toBeTruthy();
    const learning = contractFixtures.confirmCandidatesResponse.results[0];
    if (learning.type !== "learning-item") throw new Error("Learning item fixture missing.");
    expect(
      accountDataExportRecordSchema.parse({
        archivedAt: "2026-08-14T02:00:00.000Z",
        item: learning.item,
        recordType: "learning-item",
        schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
      }),
    ).toBeTruthy();
    expect(() =>
      accountDataExportRecordSchema.parse({
        item: learning.item,
        recordType: "learning-item",
        schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
      }),
    ).toThrow();
    expect(
      accountDataExportRecordSchema.parse({
        cloudWordCopyMode: "enabled",
        createdAt: "2026-08-12T01:00:00.000Z",
        dailyGoal: 5,
        extensionQueryModelMode: "platform",
        recordType: "account-preferences",
        revision: 2,
        studyCaptureMode: "automatic",
        timezone: "Asia/Shanghai",
        updatedAt: "2026-08-13T01:00:00.000Z",
      }),
    ).toBeTruthy();
    expect(
      accountDataExportRecordSchema.parse({
        action: "explain",
        createdAt: "2026-08-13T00:00:00.000Z",
        expiresAt: "2026-08-13T01:00:00.000Z",
        id: "generation-1",
        recordType: "extension-query-generation",
        selectionKind: "sentence",
        sourceText: "The plan fell through.",
        sourceType: "web-selection",
        state: "running",
      }),
    ).toBeTruthy();
    expect(() =>
      accountDataExportRecordSchema.parse({
        createdAt: "2026-08-12T01:00:00.000Z",
        dailyGoal: 5,
        email: "learner@example.com",
        recordType: "account",
        timezone: "Asia/Shanghai",
      }),
    ).toThrow();
    for (const forbidden of ["ownerUserId", "sessionToken", "credential", "leaseToken"] as const) {
      expect(() =>
        accountDataExportRecordSchema.parse({
          exportedAt: "2026-08-13T01:00:00.000Z",
          product: "huayi-cloud",
          recordType: "manifest",
          schemaVersion: 1,
          [forbidden]: "private",
        }),
      ).toThrow();
    }
  });
});

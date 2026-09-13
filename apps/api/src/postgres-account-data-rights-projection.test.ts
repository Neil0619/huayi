import { describe, expect, it } from "vitest";

import { projectAccountDataExportRow } from "./postgres-account-data-rights.js";

const readyRow = {
  byte_length: "7939",
  created_at: "2026-08-22T00:00:00.000Z",
  expires_at: "2026-08-23T00:00:00.000Z",
  format_version: 1,
  id: "20000000-0000-4000-8000-000000000001",
  last_error_code: null,
  object_key: "private-object",
  record_count: 9,
  revision: 9,
  state: "ready" as const,
  updated_at: "2026-08-22T00:01:00.000Z",
};

describe("Postgres account data export projection", () => {
  it.each([new Date(readyRow.expires_at), null])(
    "normalizes expired driver timestamps including the cleanup fallback: %s",
    (expiresAt) => {
      expect(
        projectAccountDataExportRow({
          ...readyRow,
          state: "expired",
          expires_at: expiresAt,
          updated_at: new Date(readyRow.updated_at),
        }),
      ).toMatchObject({
        state: "expired",
        expiresAt: expiresAt?.toISOString() ?? readyRow.updated_at,
      });
    },
  );
  it("converts the production driver's bigint string into a strict ready byte length", () => {
    expect(projectAccountDataExportRow(readyRow)).toMatchObject({
      byteLength: 7939,
      recordCount: 9,
      state: "ready",
    });
  });

  it("rejects malformed or unsafe bigint strings", () => {
    expect(() => projectAccountDataExportRow({ ...readyRow, byte_length: "-1" })).toThrow(
      "Invalid database integer.",
    );
    expect(() =>
      projectAccountDataExportRow({
        ...readyRow,
        byte_length: String(Number.MAX_SAFE_INTEGER + 1),
      }),
    ).toThrow("Database integer exceeds safe range.");
  });
});

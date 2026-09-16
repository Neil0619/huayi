import { describe, expect, it } from "vitest";
import { backfillViewSchema } from "./backfill-messages.js";
import { backfillErrorResponseSchema } from "./backfill-error-schema.js";
import { parseBackfillErrorCode, parseBackfillView } from "./backfill-view-parser.js";

const view = {
  status: {
    enabled: true,
    dailyHour: 8,
    revision: 1,
    scopeId: "account-a",
    pendingCount: 496,
    unresolvedCount: 2,
    unknownCount: 1,
    lastCheckedAt: null,
  },
  shared: true,
  needsLocalMerge: false,
  checkError: null,
  incomplete: false,
  lastCheckedAt: null,
};

function agreesWithSchema(input: unknown) {
  const expected = backfillViewSchema.safeParse(input);
  if (expected.success) expect(parseBackfillView(input)).toEqual(expected.data);
  else expect(() => parseBackfillView(input)).toThrow("Invalid backfill response.");
}

describe("lightweight backfill view parsing", () => {
  it("preserves schema defaults and returns detached validated data", () => {
    const result = parseBackfillView(view);
    expect(result).toEqual(backfillViewSchema.parse(view));
    expect(result).not.toBe(view);
    expect(result.status).not.toBe(view.status);
  });

  it("matches strict required fields, boolean defaults, scope and numeric bounds", () => {
    const values = [
      undefined,
      null,
      false,
      true,
      "",
      "1",
      -1,
      0,
      1,
      23,
      24,
      1.5,
      NaN,
      Infinity,
      {},
      [],
      "x".repeat(200),
      "x".repeat(201),
      "x".repeat(300),
      "x".repeat(301),
    ];
    for (const field of [
      ...Object.keys(view),
      "initializing",
      "checking",
      "localMergeBlocked",
      "reconnectRequired",
      "extra",
    ]) {
      for (const value of values) agreesWithSchema({ ...view, [field]: value });
      const missing: Record<string, unknown> = { ...view };
      Reflect.deleteProperty(missing, field);
      agreesWithSchema(missing);
    }
    for (const field of [...Object.keys(view.status), "extra"]) {
      for (const value of values)
        agreesWithSchema({ ...view, status: { ...view.status, [field]: value } });
      const missing: Record<string, unknown> = { ...view.status };
      Reflect.deleteProperty(missing, field);
      agreesWithSchema({ ...view, status: missing });
    }
    for (const input of [undefined, null, [], true, 1, "view"]) agreesWithSchema(input);
  });

  it("matches the offset datetime contract including leap days and optional seconds", () => {
    const dates = [
      null,
      "2026-09-16T09:10Z",
      "2026-09-16T09:10:11.123456Z",
      "2026-09-16T09:10:11+08:00",
      "2026-09-16T09:10:11-0800",
      "0000-02-29T00:00Z",
      "2000-02-29T00:00Z",
      "1900-02-29T00:00Z",
      "2024-02-29T00:00Z",
      "2025-02-29T00:00Z",
      "2026-04-31T00:00Z",
      "2026-09-16T24:00Z",
      "2026-09-16T23:60Z",
      "2026-09-16T23:59:60Z",
      "2026-09-16T09:10:11",
      "2026-09-16T09:10:11z",
      "2026-09-16",
      "2026-09-16T09:10:11+99:99",
      "2026-09-16T09:10:11Z\n",
      "bad-date",
    ];
    for (const date of dates) {
      agreesWithSchema({ ...view, lastCheckedAt: date });
      agreesWithSchema({ ...view, status: { ...view.status, lastCheckedAt: date } });
    }
  });

  it("accepts only strict recognized error envelopes and never trusts their text", () => {
    for (const code of [
      "unavailable",
      "connection",
      "authentication",
      "request-failed",
      "permission",
      "unknown",
      null,
    ]) {
      for (const error of ["", "remote-private-text", "x".repeat(300), "x".repeat(301), null]) {
        for (const extra of [{}, { unexpected: true }]) {
          const input = { code, error, ...extra };
          const expected = backfillErrorResponseSchema.safeParse(input);
          expect(parseBackfillErrorCode(input)).toBe(
            expected.success ? expected.data.code : "request-failed",
          );
        }
      }
    }
    for (const input of [undefined, null, [], { error: "private" }, { code: "authentication" }]) {
      expect(parseBackfillErrorCode(input)).toBe("request-failed");
    }
  });
});

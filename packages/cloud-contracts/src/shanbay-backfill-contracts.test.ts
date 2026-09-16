import { describe, expect, it } from "vitest";
import {
  shanbayBackfillCommandSchema,
  shanbayBackfillLeaseSchema,
  shanbayBackfillUnresolvedSchema,
} from "./shanbay-backfill-contracts.js";
import { shanbayBackfillExportRecordSchema } from "./shanbay-backfill-export.js";

const words = Array.from(
  { length: 101 },
  (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
);
const lease = { token: "batch", expiresAt: "2026-09-16T08:05:00.000Z" };

describe("Shanbay backfill batch wire compatibility", () => {
  it("preserves old claim request serialization while accepting an explicit 100-word limit", () => {
    expect(shanbayBackfillCommandSchema.parse({ action: "claim" })).toEqual({ action: "claim" });
    expect(shanbayBackfillCommandSchema.parse({ action: "claim", limit: 100 })).toEqual({
      action: "claim",
      limit: 100,
    });
  });

  it.each([0, 101, 1.5, "100", null])("rejects an invalid claim limit %s", (limit) => {
    expect(shanbayBackfillCommandSchema.safeParse({ action: "claim", limit }).success).toBe(false);
  });

  it.each([20, 100])("accepts existing and new %i-word leases, outcomes and exports", (count) => {
    const headwords = words.slice(0, count);
    expect(shanbayBackfillLeaseSchema.parse({ ...lease, headwords }).headwords).toEqual(headwords);
    expect(
      shanbayBackfillCommandSchema.parse({
        action: "resolve",
        token: lease.token,
        confirmed: headwords,
        rejected: [],
      }),
    ).toMatchObject({ confirmed: headwords });
    expect(
      shanbayBackfillExportRecordSchema.parse({
        recordType: "shanbay-backfill-batch",
        batch: { headwords, expiresAt: lease.expiresAt, state: "resolved" },
      }),
    ).toMatchObject({ batch: { headwords } });
    expect(
      shanbayBackfillUnresolvedSchema.parse({
        items: [],
        unknownBatches: [{ token: lease.token, headwords }],
        nextCursor: null,
        revision: 1,
      }),
    ).toMatchObject({ unknownBatches: [{ headwords, token: lease.token }] });
  });

  it("rejects more than 100 words in wire leases, outcomes, unknown batches and exports", () => {
    expect(shanbayBackfillLeaseSchema.safeParse({ ...lease, headwords: words }).success).toBe(
      false,
    );
    for (const confirmed of [true, false])
      expect(
        shanbayBackfillCommandSchema.safeParse({
          action: "resolve",
          token: lease.token,
          confirmed: confirmed ? words : [],
          rejected: confirmed ? [] : words,
        }).success,
      ).toBe(false);
    expect(
      shanbayBackfillExportRecordSchema.safeParse({
        recordType: "shanbay-backfill-batch",
        batch: { headwords: words, expiresAt: lease.expiresAt, state: "resolved" },
      }).success,
    ).toBe(false);
    expect(
      shanbayBackfillUnresolvedSchema.safeParse({
        items: [],
        unknownBatches: [{ token: lease.token, headwords: words }],
        nextCursor: null,
        revision: 1,
      }).success,
    ).toBe(false);
  });
});

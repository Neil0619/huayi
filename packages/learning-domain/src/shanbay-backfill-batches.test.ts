import { describe, expect, it } from "vitest";
import { backfillBatchSchema, backfillStateSchema } from "./shanbay-backfill-schema.js";
import {
  backfillStatus,
  claimBackfillBatch,
  createBackfillState,
  discoverBackfill,
  renewBackfillBatch,
  resolveBackfillBatch,
} from "./shanbay-backfill.js";

const now = "2026-09-16T08:00:00.000Z";
const later = "2026-09-16T08:01:00.000Z";
const lease = { holder: "device-one", token: "batch-one", now };
const words = Array.from(
  { length: 101 },
  (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
);

describe("Shanbay backfill batch bounds and receipt compatibility", () => {
  it.each([1, 20, 100, 101])("bounds an explicit claim limit of %i to 100", (limit) => {
    const state = createBackfillState();
    discoverBackfill(state, words, "local", now);
    expect(claimBackfillBatch(state, { ...lease, limit })?.headwords).toEqual(
      words.slice(0, Math.min(limit, 100)),
    );
  });

  it.each([20, 100])("reloads and settles a persisted %i-word lease", (count) => {
    const state = createBackfillState();
    discoverBackfill(state, words.slice(0, count), "local", now);
    const record = {
      holder: lease.holder,
      token: lease.token,
      headwords: words.slice(0, count),
      state: "prepared",
      expiresAt: "2026-09-16T08:05:00.000Z",
    };
    const loaded = backfillStateSchema.parse({ ...state, batches: [record] });
    expect(renewBackfillBatch(loaded, { ...lease, now: later })).toBe(true);
    expect(
      resolveBackfillBatch(loaded, {
        ...lease,
        now: later,
        confirmed: words.slice(0, count),
        rejected: [],
        findLemma: () => null,
      }),
    ).toBe(true);
    expect(backfillStatus(loaded)).toEqual({
      pendingCount: 0,
      unknownCount: 0,
      unresolvedCount: 0,
    });
  });

  it("rejects persisted batches larger than 100", () => {
    expect(
      backfillBatchSchema.safeParse({
        token: lease.token,
        holder: lease.holder,
        headwords: words,
        state: "prepared",
        expiresAt: later,
      }).success,
    ).toBe(false);
  });

  it("settles 98 confirmations and two explicit rejections without reissuing confirmed targets", () => {
    const state = createBackfillState();
    const confirmed = words.slice(0, 98);
    discoverBackfill(state, [...confirmed, "walking", "axes"], "local", now);
    expect(claimBackfillBatch(state, lease)?.headwords).toHaveLength(100);
    expect(
      resolveBackfillBatch(state, {
        ...lease,
        now: later,
        confirmed,
        rejected: ["walking", "axes"],
        findLemma: (word) => (word === "walking" ? "walk" : null),
      }),
    ).toBe(true);
    expect(backfillStatus(state)).toEqual({ pendingCount: 1, unknownCount: 0, unresolvedCount: 1 });
    expect(claimBackfillBatch(state, { ...lease, token: "next" })?.headwords).toEqual(["walk"]);
  });

  it("keeps all 100 targets unknown when a receipt leaves even one outcome unreported", () => {
    const state = createBackfillState();
    discoverBackfill(state, words.slice(0, 100), "local", now);
    expect(claimBackfillBatch(state, lease)?.headwords).toHaveLength(100);
    expect(
      resolveBackfillBatch(state, {
        ...lease,
        now: later,
        confirmed: words.slice(0, 99),
        rejected: [],
        findLemma: () => "word",
      }),
    ).toBe(false);
    const loaded = backfillStateSchema.parse(state);
    expect(Object.values(loaded.targets).every((target) => target.confirmedAt === null)).toBe(true);
    expect(backfillStatus(loaded)).toEqual({
      pendingCount: 0,
      unknownCount: 100,
      unresolvedCount: 0,
    });
    expect(claimBackfillBatch(loaded, { ...lease, token: "automatic-retry" })).toBeNull();
  });
});

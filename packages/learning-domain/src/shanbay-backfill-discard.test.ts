import { describe, expect, it } from "vitest";
import {
  backfillStatus,
  claimBackfillBatch,
  confirmBackfillTargets,
  createBackfillState,
  discardAllBackfillUnresolved,
  discoverBackfill,
  markBackfillUnknown,
  resolveBackfillBatch,
} from "./shanbay-backfill.js";
import { findBackfillLemma } from "./shanbay-lemma.js";

const now = "2026-09-16T08:00:00.000Z";
const later = "2026-09-16T08:01:00.000Z";
const words = Array.from(
  { length: 151 },
  (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
);

describe("discard all unresolved backfill sources", () => {
  it("discards beyond one page and preserves source history, targets and all batch receipts", () => {
    const state = createBackfillState();
    discoverBackfill(state, words, "local", now);
    for (const source of Object.values(state.sources)) {
      source.state = "unresolved";
      source.attempt = "manual";
    }
    discoverBackfill(state, ["pending", "confirmed", "unknown"], "local", now);
    confirmBackfillTargets(state, ["confirmed"], now);
    const held = claimBackfillBatch(state, { holder: "device", token: "held", now });
    expect(held?.headwords).toEqual(["pending", "unknown"]);
    markBackfillUnknown(state, "held", now);
    state.batches.push({
      token: "receipt",
      holder: "device",
      state: "resolved",
      headwords: [words[0] ?? "wordaa"],
      expiresAt: later,
    });
    const before = structuredClone(state);

    expect(discardAllBackfillUnresolved(state, later)).toBe(151);
    for (const word of words)
      expect(state.sources[word]).toEqual({
        ...before.sources[word],
        state: "discarded",
        updatedAt: later,
      });
    for (const word of ["pending", "confirmed", "unknown"])
      expect(state.sources[word]).toEqual(before.sources[word]);
    expect(state.targets).toEqual(before.targets);
    expect(state.batches).toEqual(before.batches);
    expect(backfillStatus(state)).toEqual({
      pendingCount: 0,
      unresolvedCount: 0,
      unknownCount: 2,
    });
    expect(discardAllBackfillUnresolved(state, later)).toBe(0);
    discoverBackfill(state, words, "cloud", later);
    expect(words.every((word) => state.sources[word]?.state === "discarded")).toBe(true);
    expect(claimBackfillBatch(state, { holder: "device", token: "rescan", now: later })).toBeNull();
  });

  it("keeps an unresolved source attached to an unknown batch hold intact", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["held", "free"], "local", now);
    for (const source of Object.values(state.sources)) source.state = "unresolved";
    state.batches.push({
      token: "unknown",
      holder: "device",
      state: "unknown",
      headwords: ["held"],
      expiresAt: later,
    });
    const held = structuredClone(state.sources.held);
    expect(discardAllBackfillUnresolved(state, later)).toBe(1);
    expect(state.sources.held).toEqual(held);
    expect(state.sources.free?.state).toBe("discarded");
    expect(state.batches[0]?.state).toBe("unknown");
  });
});

describe("same-batch lemma rejection", () => {
  it.each([
    ["walking", "walk"],
    ["walk", "walking"],
  ])("does not reissue a lemma rejected alongside its source in order %j", (...headwords) => {
    const state = createBackfillState();
    discoverBackfill(state, headwords, "local", now);
    const lease = { holder: "device", token: "batch", now };
    claimBackfillBatch(state, lease);
    expect(
      resolveBackfillBatch(state, {
        ...lease,
        now: later,
        confirmed: [],
        rejected: headwords,
        findLemma: findBackfillLemma,
      }),
    ).toBe(true);
    expect(state.sources.walking).toMatchObject({
      attempt: "lemma",
      target: "walk",
      state: "unresolved",
    });
    expect(state.sources.walk?.state).toBe("unresolved");
    expect(claimBackfillBatch(state, { ...lease, token: "repeated" })).toBeNull();
  });
});

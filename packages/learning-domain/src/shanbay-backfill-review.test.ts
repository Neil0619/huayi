import { describe, expect, it } from "vitest";
import {
  backfillStatus,
  claimBackfillBatch,
  createBackfillState,
  discoverBackfill,
  markBackfillUnknown,
  retryBackfillUnknown,
  resolveBackfillBatch,
  expireBackfillBatches,
  replaceBackfillSource,
} from "./shanbay-backfill.js";
import { adoptBackfill } from "./shanbay-backfill-adoption.js";
import { backfillStateSchema } from "./shanbay-backfill-schema.js";
import {
  discardBackfillUnknown,
  discardAllBackfillReview,
  adoptBackfillDismissed,
  backfillReviewBatches,
} from "./shanbay-backfill-review.js";

const now = "2026-09-16T08:00:00.000Z";
const later = "2026-09-16T08:01:00.000Z";
const words = Array.from(
  { length: 40 },
  (_, i) => `word${String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26))}`,
);
const lease = { holder: "device", token: "first", now };
function unknownState() {
  const state = createBackfillState();
  discoverBackfill(state, words, "local", now);
  claimBackfillBatch(state, { ...lease, limit: 20 });
  markBackfillUnknown(state, lease.token, now);
  claimBackfillBatch(state, { ...lease, token: "second", limit: 20 });
  markBackfillUnknown(state, "second", now);
  return state;
}

describe("explicit unknown review dismissal", () => {
  it("clears the exact two-by-twenty unknown-only review and preserves unconfirmed suppression across reload/discovery", () => {
    const state = unknownState();
    expect(backfillStatus(state)).toEqual({
      pendingCount: 0,
      unresolvedCount: 0,
      unknownCount: 40,
    });
    const before = structuredClone(state);
    discardAllBackfillReview(state, later);
    expect(backfillStatus(state)).toEqual({ pendingCount: 0, unresolvedCount: 0, unknownCount: 0 });
    expect(backfillReviewBatches(state)).toEqual([]);
    expect(state.targets).toEqual(before.targets);
    expect(state.batches).toEqual(
      before.batches.map((batch) => ({ ...batch, dismissedAt: later })),
    );
    expect(Object.values(state.sources).every((s) => s.state === "discarded")).toBe(true);
    const reloaded = backfillStateSchema.parse(JSON.parse(JSON.stringify(state)));
    discoverBackfill(reloaded, words, "cloud", later);
    expect(claimBackfillBatch(reloaded, { ...lease, token: "late" })).toBeNull();
    expect(retryBackfillUnknown(reloaded, "first", later)).toBe(false);
    expect(
      resolveBackfillBatch(reloaded, {
        ...lease,
        now: later,
        confirmed: words.slice(0, 20),
        rejected: [],
        findLemma: () => null,
      }),
    ).toBe(false);
    expect(Object.values(reloaded.targets).every((t) => t.confirmedAt === null)).toBe(true);
  });

  it("dismisses all mapped sources and hides overlaps without releasing another unknown hold", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["walk", "walking"], "local", now);
    const walking = state.sources.walking;
    if (!walking) throw new Error("Missing source.");
    walking.target = "walk";
    walking.attempt = "lemma";
    claimBackfillBatch(state, lease);
    markBackfillUnknown(state, "first", now);
    const first = state.batches[0];
    if (!first) throw new Error("Missing batch.");
    state.batches.push({ ...first, token: "overlap" });
    expect(discardBackfillUnknown(state, "first", later)).toBe(true);
    expect(Object.values(state.sources).every((s) => s.state === "discarded")).toBe(true);
    expect(backfillStatus(state).unknownCount).toBe(0);
    expect(backfillReviewBatches(state)).toEqual([]);
    expect(retryBackfillUnknown(state, "overlap", later)).toBe(false);
    expect(discardBackfillUnknown(state, "first", later)).toBe(false);
  });

  it("allows retry of the undismissed remainder of an overlapping unknown batch", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["walk", "bird"], "local", now);
    state.batches.push(
      { token: "dismiss", holder: "device", headwords: ["walk"], state: "unknown", expiresAt: now },
      {
        token: "mixed",
        holder: "device",
        headwords: ["walk", "bird"],
        state: "unknown",
        expiresAt: now,
      },
    );
    expect(discardBackfillUnknown(state, "dismiss", later)).toBe(true);
    expect(backfillReviewBatches(state).map((batch) => batch.headwords)).toEqual([["bird"]]);
    expect(retryBackfillUnknown(state, "mixed", later)).toBe(true);
    expect(claimBackfillBatch(state, { ...lease, token: "remaining" })?.headwords).toEqual([
      "bird",
    ]);
    expect(state.sources.walk?.state).toBe("discarded");
    expect(state.targets.walk?.confirmedAt).toBeNull();
  });

  it("preserves an active prepared batch, every mapped source and lease when review overlaps", () => {
    const state = unknownState();
    state.batches.push({
      ...lease,
      headwords: [words[0] ?? "wordaa"],
      state: "prepared",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    const before = structuredClone(state);
    expect(discardBackfillUnknown(state, "first", later)).toBe(false);
    expect(state).toEqual(before);
    discardAllBackfillReview(state, later);
    expect(state.batches[0]).toEqual(before.batches[0]);
    expect(state.batches[2]).toEqual(before.batches[2]);
    for (const word of words.slice(0, 20))
      expect(state.sources[word]).toEqual(before.sources[word]);
    expect(state.batches[1]?.dismissedAt).toBe(later);
  });

  it("accepts source-less evidence, then protects late and repeated mapped adoption without inventing origins", () => {
    const state = createBackfillState();
    const evidence = [{ headwords: ["walk"], dismissedAt: now }];
    adoptBackfillDismissed(state, evidence, { holder: "device", token: () => "adopted", now });
    expect(state.sources).toEqual({});
    expect(backfillStatus(state).unknownCount).toBe(0);
    discoverBackfill(state, ["walk", "walker"], "cloud", later);
    const incoming = {
      headword: "walking",
      target: "walk",
      origins: ["local" as const],
      attempt: "lemma" as const,
      state: "pending" as const,
      updatedAt: now,
    };
    adoptBackfill(state, [incoming], [], later);
    expect(state.sources.walking).toMatchObject({ state: "discarded", origins: ["local"] });
    expect(state.sources.walk?.state).toBe("discarded");
    adoptBackfill(state, [incoming], [], later);
    adoptBackfillDismissed(state, evidence, { holder: "device", token: () => "again", now: later });
    expect(state.batches).toHaveLength(1);
    const walker = state.sources.walker;
    if (!walker) throw new Error("Missing source.");
    walker.state = "unresolved";
    expect(replaceBackfillSource(state, "walker", "walk", later)).toBe(true);
    expect(walker.state).toBe("discarded");
    expect(claimBackfillBatch(state, { ...lease, token: "later" })).toBeNull();
    expect(Object.values(state.targets).every((t) => t.confirmedAt === null)).toBe(true);
  });

  it("retains imported dismissal evidence while protecting active sources until their lease expires", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["walk"], "cloud", now);
    claimBackfillBatch(state, lease);
    const prepared = structuredClone(state.batches[0]);
    adoptBackfillDismissed(state, [{ headwords: ["walk"], dismissedAt: now }], {
      holder: "import",
      token: () => "imported",
      now: later,
    });
    expect(state.sources.walk?.state).toBe("pending");
    expect(state.batches[0]).toEqual(prepared);
    expireBackfillBatches(state, "2026-09-16T08:06:00.000Z");
    expect(state.sources.walk?.state).toBe("discarded");
    expect(backfillStatus(state).unknownCount).toBe(0);
    expect(retryBackfillUnknown(state, "first", later)).toBe(false);
  });

  it("reads old batch JSON without adding dismissal evidence", () => {
    const state = unknownState();
    expect(backfillStateSchema.parse(state)).toEqual(state);
  });
});

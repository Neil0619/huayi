import { describe, expect, it } from "vitest";

import {
  backfillStatus,
  claimBackfillBatch,
  createBackfillState,
  discardBackfillSource,
  discoverBackfill,
  markBackfillUnknown,
  renewBackfillBatch,
  replaceBackfillSource,
  resolveBackfillBatch,
  retryBackfillUnknown,
} from "./shanbay-backfill.js";

const now = "2026-09-15T08:00:00.000Z";
const later = "2026-09-15T08:01:00.000Z";
const expired = "2026-09-15T08:06:00.000Z";
const holder = "device-one";
type State = ReturnType<typeof createBackfillState>;

function claim(state: State, token = "batch-one", at = now) {
  const batch = claimBackfillBatch(state, { holder, now: at, token });
  if (batch === null) throw new Error("Expected a pending backfill batch.");
  return batch;
}

function confirm(state: State, token: string, confirmed: string[], at = later) {
  return resolveBackfillBatch(state, {
    confirmed,
    findLemma: () => null,
    holder,
    now: at,
    rejected: [],
    token,
  });
}

describe("Shanbay backfill domain", () => {
  it("delivers 21 ordinary words in batches of 20 and one, without reissuing confirmations", () => {
    const state = createBackfillState();
    const words = [
      "apple",
      "bird",
      "cloud",
      "door",
      "earth",
      "flower",
      "garden",
      "house",
      "island",
      "journey",
      "king",
      "light",
      "mountain",
      "night",
      "ocean",
      "paper",
      "queen",
      "river",
      "stone",
      "tree",
      "window",
    ];
    discoverBackfill(state, words, "eudic", now);
    expect(backfillStatus(state)).toEqual({
      pendingCount: 21,
      unresolvedCount: 0,
      unknownCount: 0,
    });

    const first = claim(state);
    expect(first.headwords).toHaveLength(20);
    expect(new Set(first.headwords).size).toBe(20);
    expect(first).toMatchObject({
      holder,
      state: "prepared",
      expiresAt: "2026-09-15T08:05:00.000Z",
    });
    expect(confirm(state, first.token, first.headwords)).toBe(true);
    const second = claim(state, "batch-two", later);
    expect(second.headwords).toHaveLength(1);
    expect([...first.headwords, ...second.headwords].sort()).toEqual([...words].sort());
    expect(confirm(state, second.token, second.headwords)).toBe(true);
    expect(claimBackfillBatch(state, { holder, now: later, token: "batch-three" })).toBeNull();
    expect(backfillStatus(state)).toEqual({ pendingCount: 0, unresolvedCount: 0, unknownCount: 0 });
  });

  it("deduplicates canonical words across sources and remembers every origin after confirmation", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["Apple", "apple"], "eudic", now);
    discoverBackfill(state, ["apple"], "local", now);
    expect(Object.keys(state.sources)).toEqual(["apple"]);
    expect(Object.keys(state.targets)).toEqual(["apple"]);
    expect([...(state.sources.apple?.origins ?? [])].sort()).toEqual(["eudic", "local"]);
    const batch = claim(state);
    expect(batch.headwords).toEqual(["apple"]);
    confirm(state, batch.token, batch.headwords);

    discoverBackfill(state, ["APPLE"], "cloud", expired);
    discoverBackfill(state, ["apple"], "cloud", expired);
    expect([...(state.sources.apple?.origins ?? [])].sort()).toEqual(["cloud", "eudic", "local"]);
    expect(state.sources.apple?.state).toBe("confirmed");
    expect(state.targets.apple?.confirmedAt).toBe(later);
    expect(claimBackfillBatch(state, { holder, now: expired, token: "batch-two" })).toBeNull();
  });

  it("binds active claims and renewal to their holder and token", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["garden"], "local", now);
    const batch = claim(state);
    expect(
      claimBackfillBatch(state, { holder: "device-two", now: later, token: "other" }),
    ).toBeNull();
    const before = structuredClone(state);
    expect(
      renewBackfillBatch(state, { holder: "device-two", now: later, token: batch.token }),
    ).toBe(false);
    expect(renewBackfillBatch(state, { holder, now: later, token: "wrong" })).toBe(false);
    expect(
      resolveBackfillBatch(state, {
        confirmed: ["garden"],
        findLemma: () => null,
        holder: "device-two",
        now: later,
        rejected: [],
        token: batch.token,
      }),
    ).toBe(false);
    expect(state).toEqual(before);

    expect(renewBackfillBatch(state, { holder, now: later, token: batch.token })).toBe(true);
    expect(state.batches[0]?.expiresAt).toBe(expired);
    expect(confirm(state, batch.token, ["garden"])).toBe(true);
  });

  it("never silently reissues an expired prepared batch", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["river"], "local", now);
    const batch = claim(state);
    expect(
      claimBackfillBatch(state, { holder: "device-two", now: expired, token: "other" }),
    ).toBeNull();
    expect(state.batches[0]?.state).toBe("unknown");
    expect(backfillStatus(state).unknownCount).toBe(1);
    expect(renewBackfillBatch(state, { holder, now: expired, token: batch.token })).toBe(false);
    expect(retryBackfillUnknown(state, batch.token, expired)).toBe(true);
    expect(claim(state, "explicit-retry", expired).headwords).toEqual(["river"]);
  });

  it("preserves explicit unknown work across reload and discovery until the user retries", () => {
    let state = createBackfillState();
    discoverBackfill(state, ["cloud"], "eudic", now);
    const batch = claim(state);
    markBackfillUnknown(state, batch.token, later);
    state = structuredClone(state);
    discoverBackfill(state, ["cloud"], "local", expired);
    expect(
      claimBackfillBatch(state, { holder, now: expired, token: "automatic-retry" }),
    ).toBeNull();
    expect(state.sources.cloud?.attempt).toBe("original");
    expect(backfillStatus(state).unknownCount).toBe(1);
    expect(retryBackfillUnknown(state, batch.token, expired)).toBe(true);
    expect(retryBackfillUnknown(state, batch.token, expired)).toBe(false);
    const retried = claim(state, "explicit-retry", expired);
    expect(retried.headwords).toEqual(["cloud"]);
    expect(backfillStatus(state).unknownCount).toBe(0);
  });

  it("makes confirmation replay a no-op even if its replay supplies a rejection", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["walking"], "local", now);
    const batch = claim(state);
    expect(confirm(state, batch.token, ["walking"])).toBe(true);
    const confirmed = structuredClone(state);
    expect(confirm(state, batch.token, ["walking"], expired)).toBe(false);
    expect(
      resolveBackfillBatch(state, {
        confirmed: [],
        findLemma: () => "walk",
        holder,
        now: expired,
        rejected: ["walking"],
        token: batch.token,
      }),
    ).toBe(false);
    expect(state).toEqual(confirmed);
  });

  it("retries a unique lemma once only after explicit rejection and keeps no-candidate words unresolved", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["walking", "splendidly", "axes"], "eudic", now);
    const original = claim(state);
    expect(
      resolveBackfillBatch(state, {
        confirmed: [],
        findLemma: (word) => (word === "walking" ? "walk" : null),
        holder,
        now: later,
        rejected: original.headwords,
        token: original.token,
      }),
    ).toBe(true);
    expect(state.sources.walking).toMatchObject({
      attempt: "lemma",
      target: "walk",
      state: "pending",
    });
    expect(state.sources.splendidly?.state).toBe("unresolved");
    expect(state.sources.axes?.state).toBe("unresolved");
    expect(backfillStatus(state)).toEqual({ pendingCount: 1, unresolvedCount: 2, unknownCount: 0 });
    const lemma = claim(state, "lemma-batch", later);
    expect(lemma.headwords).toEqual(["walk"]);
    expect(
      resolveBackfillBatch(state, {
        confirmed: [],
        findLemma: () => "walking",
        holder,
        now: later,
        rejected: ["walk"],
        token: lemma.token,
      }),
    ).toBe(true);
    expect(state.sources.walking).toMatchObject({
      attempt: "lemma",
      target: "walk",
      state: "unresolved",
    });
    discoverBackfill(state, ["walking", "splendidly", "axes"], "cloud", expired);
    expect(claimBackfillBatch(state, { holder, now: expired, token: "third-attempt" })).toBeNull();
    expect(backfillStatus(state)).toEqual({ pendingCount: 0, unresolvedCount: 3, unknownCount: 0 });
  });

  it("keeps unreported outcomes unknown instead of treating silence as a rejection or success", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["walking"], "local", now);
    const batch = claim(state);
    resolveBackfillBatch(state, {
      confirmed: [],
      findLemma: () => "walk",
      holder,
      now: later,
      rejected: [],
      token: batch.token,
    });
    expect(state.sources.walking).toMatchObject({ attempt: "original", target: "walking" });
    expect(state.targets.walking?.confirmedAt).toBeNull();
    expect(backfillStatus(state).unknownCount).toBe(1);
    expect(
      claimBackfillBatch(state, { holder, now: expired, token: "automatic-retry" }),
    ).toBeNull();
  });

  it("persists manual replacements and discards through reloads and source rediscovery", () => {
    let state = createBackfillState();
    discoverBackfill(state, ["splendidly", "axes"], "eudic", now);
    const batch = claim(state);
    resolveBackfillBatch(state, {
      confirmed: [],
      findLemma: () => null,
      holder,
      now: later,
      rejected: batch.headwords,
      token: batch.token,
    });
    replaceBackfillSource(state, "splendidly", "splendid", later);
    discardBackfillSource(state, "axes", later);
    state = structuredClone(state);
    discoverBackfill(state, ["splendidly", "axes"], "cloud", expired);
    expect(state.sources.splendidly).toMatchObject({
      attempt: "manual",
      target: "splendid",
      state: "pending",
    });
    expect(state.sources.axes?.state).toBe("discarded");
    const manual = claim(state, "manual-batch", expired);
    expect(manual.headwords).toEqual(["splendid"]);
    confirm(state, manual.token, manual.headwords, expired);
    discoverBackfill(state, ["splendidly", "axes"], "local", expired);
    expect(state.sources.splendidly).toMatchObject({
      attempt: "manual",
      target: "splendid",
      state: "confirmed",
    });
    expect(state.sources.axes?.state).toBe("discarded");
    expect(backfillStatus(state)).toEqual({ pendingCount: 0, unresolvedCount: 0, unknownCount: 0 });
  });

  it("deduplicates two rejected source forms into one lemma target and confirms both", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["walking", "walked"], "eudic", now);
    const original = claim(state);
    resolveBackfillBatch(state, {
      confirmed: [],
      findLemma: () => "walk",
      holder,
      now: later,
      rejected: original.headwords,
      token: original.token,
    });
    const lemma = claim(state, "lemma-batch", later);
    expect(lemma.headwords).toEqual(["walk"]);
    confirm(state, lemma.token, lemma.headwords);
    expect(state.sources.walking?.state).toBe("confirmed");
    expect(state.sources.walked?.state).toBe("confirmed");
    expect(state.targets.walk?.confirmedAt).toBe(later);
    expect(backfillStatus(state)).toEqual({ pendingCount: 0, unresolvedCount: 0, unknownCount: 0 });
  });

  it("covers a rejected source when its lemma target was confirmed in the same batch", () => {
    const state = createBackfillState();
    discoverBackfill(state, ["walking", "walk"], "local", now);
    const batch = claim(state);
    resolveBackfillBatch(state, {
      confirmed: ["walk"],
      findLemma: () => "walk",
      holder,
      now: later,
      rejected: ["walking"],
      token: batch.token,
    });
    expect(state.sources.walking).toMatchObject({
      attempt: "lemma",
      target: "walk",
      state: "confirmed",
    });
    expect(state.sources.walk?.state).toBe("confirmed");
    expect(claimBackfillBatch(state, { holder, now: later, token: "duplicate-target" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  calculateConservativeReservation,
  calculateModelCost,
  createNewSchedule,
  quotaSummary,
  rateSchedule,
  rateScheduleIdempotently,
} from "./index.js";

describe("fixed practice schedule", () => {
  const ratingTime = "2026-08-12T10:00:00.000Z";

  it("starts at level -1 and applies every rating with the public day ladder", () => {
    const fresh = createNewSchedule();
    expect(fresh).toEqual({ consecutiveMastered: 0, dueAt: null, level: -1 });
    expect(rateSchedule(fresh, "effortful", ratingTime)).toEqual({
      consecutiveMastered: 0,
      dueAt: "2026-08-13T10:00:00.000Z",
      lastRating: "effortful",
      level: 0,
    });
    expect(
      rateSchedule(
        {
          consecutiveMastered: 2,
          dueAt: ratingTime,
          lastRating: "mastered",
          level: 2,
        },
        "forgot",
        ratingTime,
      ),
    ).toMatchObject({ consecutiveMastered: 0, dueAt: "2026-08-13T10:00:00.000Z", level: 0 });
    expect(
      rateSchedule(
        { consecutiveMastered: 2, dueAt: ratingTime, lastRating: "mastered", level: 2 },
        "effortful",
        ratingTime,
      ),
    ).toMatchObject({ consecutiveMastered: 0, dueAt: "2026-08-19T10:00:00.000Z", level: 2 });
    expect(
      rateSchedule(
        { consecutiveMastered: 5, dueAt: ratingTime, lastRating: "mastered", level: 5 },
        "mastered",
        ratingTime,
      ),
    ).toMatchObject({ consecutiveMastered: 6, dueAt: "2026-10-11T10:00:00.000Z", level: 5 });
  });

  it("returns the original rating application when a session/item rating is replayed", () => {
    const first = rateScheduleIdempotently({
      itemId: "item-1",
      rating: "mastered",
      ratingTime,
      sessionId: "session-1",
      state: createNewSchedule(),
    });
    const replay = rateScheduleIdempotently({
      itemId: "item-1",
      previous: first,
      rating: "mastered",
      ratingTime: "2026-08-12T10:05:00.000Z",
      sessionId: "session-1",
      state: first.after,
    });
    expect(replay).toEqual(first);
    expect(() =>
      rateScheduleIdempotently({
        itemId: "item-1",
        previous: first,
        rating: "forgot",
        ratingTime,
        sessionId: "session-1",
        state: first.after,
      }),
    ).toThrow("conflict");
  });
});

describe("micro-USD quota calculations", () => {
  const price = {
    cachedInputMicroUsdPerMillionTokens: 100_000,
    inputMicroUsdPerMillionTokens: 1_000_000,
    outputMicroUsdPerMillionTokens: 2_000_000,
  };

  it("uses integer ceil rounding and separates cached input", () => {
    expect(
      calculateModelCost({ cachedInputTokens: 500, inputTokens: 1_000, outputTokens: 250 }, price),
    ).toBe(1_050);
    expect(
      calculateModelCost({ cachedInputTokens: 0, inputTokens: 1, outputTokens: 0 }, price),
    ).toBe(1);
  });

  it("reserves without assuming a cache discount and computes conservative allowance", () => {
    expect(calculateConservativeReservation({ inputTokens: 1_000, outputTokens: 500 }, price)).toBe(
      2_000,
    );
    expect(
      quotaSummary({ limitMicroUsd: 1_000_000, reservedMicroUsd: 100_000, usedMicroUsd: 800_000 }),
    ).toEqual({
      availableMicroUsd: 100_000,
      limitMicroUsd: 1_000_000,
      percentUsed: 80,
      reservedMicroUsd: 100_000,
      usedMicroUsd: 800_000,
      warning: "warning",
    });
  });

  it("rejects invalid token/cache bounds and unsafe money", () => {
    expect(() =>
      calculateModelCost({ cachedInputTokens: 2, inputTokens: 1, outputTokens: 0 }, price),
    ).toThrow();
    expect(() =>
      calculateModelCost(
        { cachedInputTokens: 0, inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 },
        price,
      ),
    ).toThrow();
  });
});

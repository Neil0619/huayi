import { describe, expect, it } from "vitest";

import {
  createDeepSeekPriceSchedule,
  DEEPSEEK_LEGACY_PRICES,
  DEEPSEEK_OFF_PEAK_PRICES,
  DEEPSEEK_PEAK_PRICES,
} from "./deepseek-price-schedule.js";

const ids = {
  legacy: "10000000-0000-4000-8000-000000000001",
  offPeak: "10000000-0000-4000-8000-000000000002",
  peak: "10000000-0000-4000-8000-000000000003",
};

describe("DeepSeek V4 Flash price schedule", () => {
  const schedule = createDeepSeekPriceSchedule(ids);

  it.each([
    ["2026-08-16T15:59:59.999Z", "legacy", ids.legacy, DEEPSEEK_LEGACY_PRICES],
    ["2026-08-16T16:00:00.000Z", "off-peak", ids.offPeak, DEEPSEEK_OFF_PEAK_PRICES],
    ["2026-08-17T00:59:59.999Z", "off-peak", ids.offPeak, DEEPSEEK_OFF_PEAK_PRICES],
    ["2026-08-17T01:00:00.000Z", "peak", ids.peak, DEEPSEEK_PEAK_PRICES],
    ["2026-08-17T03:59:59.999Z", "peak", ids.peak, DEEPSEEK_PEAK_PRICES],
    ["2026-08-17T04:00:00.000Z", "off-peak", ids.offPeak, DEEPSEEK_OFF_PEAK_PRICES],
    ["2026-08-17T05:59:59.999Z", "off-peak", ids.offPeak, DEEPSEEK_OFF_PEAK_PRICES],
    ["2026-08-17T06:00:00.000Z", "peak", ids.peak, DEEPSEEK_PEAK_PRICES],
    ["2026-08-17T09:59:59.999Z", "peak", ids.peak, DEEPSEEK_PEAK_PRICES],
    ["2026-08-17T10:00:00.000Z", "off-peak", ids.offPeak, DEEPSEEK_OFF_PEAK_PRICES],
  ] as const)("selects %s as %s", (instant, tier, priceVersionId, prices) => {
    expect(schedule.at(new Date(instant))).toEqual({ priceVersionId, prices, tier });
  });

  it("provides the peak reservation ceiling and immutable lookup by persisted id", () => {
    expect([DEEPSEEK_LEGACY_PRICES, DEEPSEEK_OFF_PEAK_PRICES, DEEPSEEK_PEAK_PRICES]).toSatisfy(
      (prices) => prices.every(Object.isFrozen),
    );
    expect(schedule.reservation).toEqual({
      priceVersionId: ids.peak,
      prices: DEEPSEEK_PEAK_PRICES,
      tier: "peak",
    });
    expect(schedule.byId(ids.legacy)).toEqual({
      priceVersionId: ids.legacy,
      prices: DEEPSEEK_LEGACY_PRICES,
      tier: "legacy",
    });
    expect(() => schedule.byId("10000000-0000-4000-8000-000000000099")).toThrow(
      "Unknown DeepSeek price version.",
    );
  });

  it("fails closed for duplicate ids and invalid dispatch time", () => {
    expect(() => createDeepSeekPriceSchedule({ ...ids, peak: ids.offPeak })).toThrow();
    expect(() => schedule.at(new Date(Number.NaN))).toThrow("Invalid dispatch time.");
  });
});

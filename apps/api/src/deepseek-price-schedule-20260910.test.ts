import { describe, expect, it } from "vitest";

import { DEEPSEEK_FLASH_TARIFF_20260910 } from "./deepseek-flash-tariff-20260910.js";
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
  latestOffPeak: "10000000-0000-4000-8000-000000000004",
  latestPeak: "10000000-0000-4000-8000-000000000005",
};
const latestOffPeak = {
  cachedInputMicroUsdPerMillionTokens: 2_982,
  inputMicroUsdPerMillionTokens: 149_081,
  outputMicroUsdPerMillionTokens: 596_323,
};
const latestPeak = {
  cachedInputMicroUsdPerMillionTokens: 5_964,
  inputMicroUsdPerMillionTokens: 298_162,
  outputMicroUsdPerMillionTokens: 1_192_646,
};

describe("DeepSeek Flash 2026-09-10 fixed CNY quota valuation", () => {
  it("retains the original CNY and dated ECB basis with the derived quota snapshots", () => {
    expect(DEEPSEEK_FLASH_TARIFF_20260910).toMatchObject({
      effectiveAt: "2026-09-10T04:00:00.000Z",
      officialMicroCnyPerMillionTokens: {
        offPeak: { cachedInput: 20_000, input: 1_000_000, output: 4_000_000 },
        peak: { cachedInput: 40_000, input: 2_000_000, output: 8_000_000 },
      },
      usdPerCnyReference: {
        numerator: 11_652,
        denominator: 78_159,
        observationDate: "2026-09-09",
        usdPerEur: "1.1652",
        cnyPerEur: "7.8159",
        purpose: "fixed internal quota reference valuation",
      },
    });
    expect(Object.isFrozen(DEEPSEEK_FLASH_TARIFF_20260910)).toBe(true);
    expect(Object.isFrozen(DEEPSEEK_FLASH_TARIFF_20260910.usdPerCnyReference)).toBe(true);
  });

  it("changes one long-lived schedule exactly at the notice effective time", () => {
    const schedule = createDeepSeekPriceSchedule(ids);
    expect(schedule.at(new Date("2026-09-10T03:59:59.999Z"))).toEqual({
      prices: DEEPSEEK_PEAK_PRICES,
      priceVersionId: ids.peak,
      tier: "peak",
    });
    expect(schedule.at(new Date("2026-09-10T04:00:00.000Z"))).toEqual({
      prices: latestOffPeak,
      priceVersionId: ids.latestOffPeak,
      tier: "off-peak",
    });
    expect(schedule.at(new Date("2026-09-10T06:00:00.000Z"))).toEqual({
      prices: latestPeak,
      priceVersionId: ids.latestPeak,
      tier: "peak",
    });
  });

  it.each([
    ["2026-09-11T00:59:59.999Z", "latestOffPeak"],
    ["2026-09-11T01:00:00.000Z", "latestPeak"],
    ["2026-09-11T03:59:59.999Z", "latestPeak"],
    ["2026-09-11T04:00:00.000Z", "latestOffPeak"],
    ["2026-09-11T05:59:59.999Z", "latestOffPeak"],
    ["2026-09-11T06:00:00.000Z", "latestPeak"],
    ["2026-09-11T09:59:59.999Z", "latestPeak"],
    ["2026-09-11T10:00:00.000Z", "latestOffPeak"],
    ["2026-09-12T01:00:00.000Z", "latestOffPeak"],
    ["2026-09-12T06:00:00.000Z", "latestOffPeak"],
    ["2026-09-13T01:00:00.000Z", "latestOffPeak"],
    ["2026-09-13T06:00:00.000Z", "latestOffPeak"],
    ["2026-09-13T17:00:00.000Z", "latestOffPeak"],
    ["2026-09-14T01:00:00.000Z", "latestPeak"],
    ["2026-09-14T06:00:00.000Z", "latestPeak"],
  ] as const)("selects the weekday half-open window at %s", (instant, selected) => {
    const schedule = createDeepSeekPriceSchedule(ids);
    expect(schedule.at(new Date(instant)).priceVersionId).toBe(ids[selected]);
  });

  it.each([
    ["latestOffPeak", "cachedInputMicroUsdPerMillionTokens", 20_000n, 2_982],
    ["latestOffPeak", "inputMicroUsdPerMillionTokens", 1_000_000n, 149_081],
    ["latestOffPeak", "outputMicroUsdPerMillionTokens", 4_000_000n, 596_323],
    ["latestPeak", "cachedInputMicroUsdPerMillionTokens", 40_000n, 5_964],
    ["latestPeak", "inputMicroUsdPerMillionTokens", 2_000_000n, 298_162],
    ["latestPeak", "outputMicroUsdPerMillionTokens", 8_000_000n, 1_192_646],
  ] as const)("rounds %s %s up exactly once per unit price", (tier, field, microCny, expected) => {
    const actual = createDeepSeekPriceSchedule(ids).byId(ids[tier]).prices[field];
    expect(actual).toBe(expected);
    // Independent exact bounds: the result covers the rational value, and one less does not.
    expect(BigInt(actual) * 78_159n).toBeGreaterThanOrEqual(microCny * 11_652n);
    expect(BigInt(actual - 1) * 78_159n).toBeLessThan(microCny * 11_652n);
  });

  it("keeps all old persisted snapshots stable and reserves above every reachable price", () => {
    const schedule = createDeepSeekPriceSchedule(ids);
    const oldSnapshots = [ids.legacy, ids.offPeak, ids.peak].map((id) => schedule.byId(id));
    schedule.at(new Date("2026-09-10T06:00:00Z"));
    expect(oldSnapshots.map(({ prices }) => prices)).toEqual([
      DEEPSEEK_LEGACY_PRICES,
      DEEPSEEK_OFF_PEAK_PRICES,
      DEEPSEEK_PEAK_PRICES,
    ]);
    oldSnapshots.forEach((snapshot) => {
      expect(schedule.byId(snapshot.priceVersionId)).toBe(snapshot);
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.prices)).toBe(true);
    });
    expect(schedule.reservation).toBe(schedule.byId(ids.peak));
    for (const id of Object.values(ids)) {
      const snapshot = schedule.byId(id);
      for (const field of Object.keys(latestPeak) as (keyof typeof latestPeak)[]) {
        expect(schedule.reservation.prices[field]).toBeGreaterThanOrEqual(snapshot.prices[field]);
      }
    }
  });

  it.each(["latestOffPeak", "latestPeak"] as const)("requires a unique valid %s id", (field) => {
    const { [field]: omitted, ...missing } = ids;
    expect(omitted).toBeDefined();
    expect(() => createDeepSeekPriceSchedule(missing as typeof ids)).toThrow();
    expect(() => createDeepSeekPriceSchedule({ ...ids, [field]: "invalid" })).toThrow();
    for (const [otherField, id] of Object.entries(ids)) {
      if (otherField !== field) {
        expect(() => createDeepSeekPriceSchedule({ ...ids, [field]: id })).toThrow();
      }
    }
  });
});

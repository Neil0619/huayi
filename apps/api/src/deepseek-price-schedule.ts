import { modelPriceSchema, type ModelPrice } from "@huayi/cloud-contracts";
import { z } from "zod/v3";

import {
  DEEPSEEK_FLASH_20260910_OFF_PEAK_QUOTA_PRICES,
  DEEPSEEK_FLASH_20260910_PEAK_QUOTA_PRICES,
  DEEPSEEK_FLASH_TARIFF_20260910,
} from "./deepseek-flash-tariff-20260910.js";

const DEEPSEEK_V4_PRICING_EFFECTIVE_AT_MS = Date.parse("2026-08-16T16:00:00.000Z");
const DEEPSEEK_FLASH_20260910_EFFECTIVE_AT_MS = Date.parse(
  DEEPSEEK_FLASH_TARIFF_20260910.effectiveAt,
);

export const DEEPSEEK_LEGACY_PRICES = Object.freeze(
  modelPriceSchema.parse({
    cachedInputMicroUsdPerMillionTokens: 2_800,
    inputMicroUsdPerMillionTokens: 140_000,
    outputMicroUsdPerMillionTokens: 280_000,
  }),
);
export const DEEPSEEK_OFF_PEAK_PRICES = Object.freeze(
  modelPriceSchema.parse({
    cachedInputMicroUsdPerMillionTokens: 7_000,
    inputMicroUsdPerMillionTokens: 220_000,
    outputMicroUsdPerMillionTokens: 660_000,
  }),
);
export const DEEPSEEK_PEAK_PRICES = Object.freeze(
  modelPriceSchema.parse({
    cachedInputMicroUsdPerMillionTokens: 14_000,
    inputMicroUsdPerMillionTokens: 440_000,
    outputMicroUsdPerMillionTokens: 1_320_000,
  }),
);

export type DeepSeekPriceTier = "legacy" | "off-peak" | "peak";

export interface DeepSeekPriceSnapshot {
  readonly prices: ModelPrice;
  readonly priceVersionId: string;
  readonly tier: DeepSeekPriceTier;
}

export interface DeepSeekPriceSchedule {
  readonly reservation: DeepSeekPriceSnapshot;
  at(now: Date): DeepSeekPriceSnapshot;
  byId(priceVersionId: string): DeepSeekPriceSnapshot;
}

const idsSchema = z
  .strictObject({
    legacy: z.string().uuid(),
    offPeak: z.string().uuid(),
    peak: z.string().uuid(),
    latestOffPeak: z.string().uuid(),
    latestPeak: z.string().uuid(),
  })
  .refine((ids) => new Set(Object.values(ids)).size === 5, "Price version ids must be unique.");

function snapshot(
  priceVersionId: string,
  prices: ModelPrice,
  tier: DeepSeekPriceTier,
): DeepSeekPriceSnapshot {
  return Object.freeze({ priceVersionId, prices: Object.freeze({ ...prices }), tier });
}

export function createDeepSeekPriceSchedule(idsInput: {
  legacy: string;
  offPeak: string;
  peak: string;
  latestOffPeak: string;
  latestPeak: string;
}): DeepSeekPriceSchedule {
  const ids = idsSchema.parse(idsInput);
  const snapshots = {
    legacy: snapshot(ids.legacy, DEEPSEEK_LEGACY_PRICES, "legacy"),
    offPeak: snapshot(ids.offPeak, DEEPSEEK_OFF_PEAK_PRICES, "off-peak"),
    peak: snapshot(ids.peak, DEEPSEEK_PEAK_PRICES, "peak"),
    latestOffPeak: snapshot(
      ids.latestOffPeak,
      DEEPSEEK_FLASH_20260910_OFF_PEAK_QUOTA_PRICES,
      "off-peak",
    ),
    latestPeak: snapshot(ids.latestPeak, DEEPSEEK_FLASH_20260910_PEAK_QUOTA_PRICES, "peak"),
  } as const;
  const byId = new Map(
    Object.values(snapshots).map((value) => [value.priceVersionId, value] as const),
  );
  return Object.freeze({
    at(now: Date): DeepSeekPriceSnapshot {
      const time = now.getTime();
      if (!Number.isFinite(time)) throw new Error("Invalid dispatch time.");
      if (time < DEEPSEEK_V4_PRICING_EFFECTIVE_AT_MS) return snapshots.legacy;
      const hour = now.getUTCHours();
      if (time >= DEEPSEEK_FLASH_20260910_EFFECTIVE_AT_MS) {
        const peak =
          DEEPSEEK_FLASH_TARIFF_20260910.peakWeekdaysUtc.includes(now.getUTCDay()) &&
          DEEPSEEK_FLASH_TARIFF_20260910.peakUtcHourWindows.some(
            ({ start, end }) => hour >= start && hour < end,
          );
        return peak ? snapshots.latestPeak : snapshots.latestOffPeak;
      }
      // Keep historical selection and stored snapshots unchanged before the new notice.
      return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
        ? snapshots.peak
        : snapshots.offPeak;
    },
    byId(priceVersionId: string): DeepSeekPriceSnapshot {
      const value = byId.get(priceVersionId);
      if (value === undefined) throw new Error("Unknown DeepSeek price version.");
      return value;
    },
    reservation: snapshots.peak,
  });
}

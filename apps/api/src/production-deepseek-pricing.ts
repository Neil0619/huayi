import { createDeepSeekPriceSchedule } from "./deepseek-price-schedule.js";
import type { ApiEnvironment } from "./environment.js";

export function createProductionDeepSeekPricing(environment: ApiEnvironment) {
  return createDeepSeekPriceSchedule({
    legacy: environment.HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID,
    offPeak: environment.HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID,
    peak: environment.HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID,
    latestOffPeak: environment.HUAYI_DEEPSEEK_20260910_OFF_PEAK_PRICE_VERSION_ID,
    latestPeak: environment.HUAYI_DEEPSEEK_20260910_PEAK_PRICE_VERSION_ID,
  });
}

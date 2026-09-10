import { modelPriceSchema } from "@huayi/cloud-contracts";

// Fixed internal quota reference values, never an official USD tariff or an FX execution rate.
// Future revisions must add a new dated module and immutable price IDs, not edit this basis.
export const DEEPSEEK_FLASH_TARIFF_20260910 = Object.freeze({
  effectiveAt: "2026-09-10T04:00:00.000Z",
  tariffSource: "User-provided official DeepSeek platform pricing notice, 2026-09-10",
  peakWindowSource: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
  peakWeekdaysUtc: Object.freeze([1, 2, 3, 4, 5]),
  peakUtcHourWindows: Object.freeze([
    Object.freeze({ start: 1, end: 4 }),
    Object.freeze({ start: 6, end: 10 }),
  ]),
  officialMicroCnyPerMillionTokens: Object.freeze({
    offPeak: Object.freeze({ cachedInput: 20_000, input: 1_000_000, output: 4_000_000 }),
    peak: Object.freeze({ cachedInput: 40_000, input: 2_000_000, output: 8_000_000 }),
  }),
  usdPerCnyReference: Object.freeze({
    numerator: 11_652,
    denominator: 78_159,
    observationDate: "2026-09-09",
    usdPerEur: "1.1652",
    cnyPerEur: "7.8159",
    source:
      "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.hr.html",
    purpose: "fixed internal quota reference valuation",
    rounding: "ceil each unit price to integer micro-USD per million tokens",
  }),
});

function quotaUnitPrice(microCnyPerMillionTokens: number): number {
  const reference = DEEPSEEK_FLASH_TARIFF_20260910.usdPerCnyReference;
  const numerator = BigInt(microCnyPerMillionTokens) * BigInt(reference.numerator);
  const denominator = BigInt(reference.denominator);
  return Number((numerator + denominator - 1n) / denominator);
}

function quotaPrices(prices: { cachedInput: number; input: number; output: number }) {
  return Object.freeze(
    modelPriceSchema.parse({
      cachedInputMicroUsdPerMillionTokens: quotaUnitPrice(prices.cachedInput),
      inputMicroUsdPerMillionTokens: quotaUnitPrice(prices.input),
      outputMicroUsdPerMillionTokens: quotaUnitPrice(prices.output),
    }),
  );
}

export const DEEPSEEK_FLASH_20260910_OFF_PEAK_QUOTA_PRICES = quotaPrices(
  DEEPSEEK_FLASH_TARIFF_20260910.officialMicroCnyPerMillionTokens.offPeak,
);
export const DEEPSEEK_FLASH_20260910_PEAK_QUOTA_PRICES = quotaPrices(
  DEEPSEEK_FLASH_TARIFF_20260910.officialMicroCnyPerMillionTokens.peak,
);

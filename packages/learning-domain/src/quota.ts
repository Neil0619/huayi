import { z } from "zod/v3";

export const microUsdSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const safeIntegerSchema = microUsdSchema;

export const modelPriceSchema = z.strictObject({
  cachedInputMicroUsdPerMillionTokens: safeIntegerSchema,
  inputMicroUsdPerMillionTokens: safeIntegerSchema,
  outputMicroUsdPerMillionTokens: safeIntegerSchema,
});
export type ModelPrice = z.infer<typeof modelPriceSchema>;
export const modelPriceVersionSchema = z.strictObject({
  currency: z.literal("USD"),
  effectiveFrom: z.string().datetime({ offset: true }),
  id: z.string().trim().min(1).max(128),
  model: z.string().trim().min(1).max(200),
  prices: modelPriceSchema,
  provider: z.enum(["deepseek", "openai"]),
});
export type ModelPriceVersion = z.infer<typeof modelPriceVersionSchema>;

export const modelUsageSchema = z
  .strictObject({
    cachedInputTokens: safeIntegerSchema,
    inputTokens: safeIntegerSchema,
    outputTokens: safeIntegerSchema,
  })
  .refine((usage) => usage.cachedInputTokens <= usage.inputTokens, {
    message: "Cached input tokens cannot exceed total input tokens.",
  });
export type ModelUsage = z.infer<typeof modelUsageSchema>;

export const usageAllowanceSchema = z
  .strictObject({
    limitMicroUsd: safeIntegerSchema,
    periodEnd: z.string().datetime({ offset: true }).optional(),
    periodStart: z.string().datetime({ offset: true }).optional(),
    reservedMicroUsd: safeIntegerSchema,
    usedMicroUsd: safeIntegerSchema,
  })
  .refine(
    (allowance) =>
      (allowance.periodStart === undefined) === (allowance.periodEnd === undefined) &&
      (allowance.periodStart === undefined ||
        Date.parse(allowance.periodStart) < Date.parse(allowance.periodEnd ?? "")),
    { message: "Allowance period must be complete and ordered." },
  );
export type UsageAllowance = z.infer<typeof usageAllowanceSchema>;

function checkedCeilProduct(tokens: number, price: number): number {
  const product = BigInt(tokens) * BigInt(price);
  const rounded = (product + 999_999n) / 1_000_000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Calculated cost exceeds safe money bounds.");
  return Number(rounded);
}

export function calculateModelCost(usageInput: ModelUsage, priceInput: ModelPrice): number {
  const usage = modelUsageSchema.parse(usageInput);
  const price = modelPriceSchema.parse(priceInput);
  const uncachedTokens = usage.inputTokens - usage.cachedInputTokens;
  const cost =
    checkedCeilProduct(uncachedTokens, price.inputMicroUsdPerMillionTokens) +
    checkedCeilProduct(usage.cachedInputTokens, price.cachedInputMicroUsdPerMillionTokens) +
    checkedCeilProduct(usage.outputTokens, price.outputMicroUsdPerMillionTokens);
  if (!Number.isSafeInteger(cost)) throw new Error("Calculated cost exceeds safe money bounds.");
  return cost;
}

export function calculateConservativeReservation(
  limits: { readonly inputTokens: number; readonly outputTokens: number },
  price: ModelPrice,
): number {
  return calculateModelCost(
    { cachedInputTokens: 0, inputTokens: limits.inputTokens, outputTokens: limits.outputTokens },
    price,
  );
}

export interface QuotaSummary {
  readonly availableMicroUsd: number;
  readonly limitMicroUsd: number;
  readonly percentUsed: number;
  readonly reservedMicroUsd: number;
  readonly usedMicroUsd: number;
  readonly warning: "available" | "warning" | "exhausted";
}

export function quotaSummary(input: UsageAllowance): QuotaSummary {
  const allowance = usageAllowanceSchema.parse(input);
  const committed = allowance.usedMicroUsd + allowance.reservedMicroUsd;
  if (!Number.isSafeInteger(committed)) throw new Error("Allowance exceeds safe money bounds.");
  const availableMicroUsd = Math.max(0, allowance.limitMicroUsd - committed);
  const percentUsed =
    allowance.limitMicroUsd === 0
      ? 100
      : Math.min(100, (allowance.usedMicroUsd / allowance.limitMicroUsd) * 100);
  return {
    availableMicroUsd,
    limitMicroUsd: allowance.limitMicroUsd,
    percentUsed,
    reservedMicroUsd: allowance.reservedMicroUsd,
    usedMicroUsd: allowance.usedMicroUsd,
    warning:
      committed >= allowance.limitMicroUsd
        ? "exhausted"
        : percentUsed >= 80
          ? "warning"
          : "available",
  };
}

import { z } from "zod/v3";
import { modelUsageSchema } from "@huayi/cloud-contracts";
export const providerUsageSchema = z
  .strictObject({
    completion_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    completion_tokens_details: z
      .strictObject({
        reasoning_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      })
      .optional(),
    prompt_cache_hit_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    prompt_cache_miss_tokens: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    prompt_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    prompt_tokens_details: z
      .strictObject({
        cached_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      })
      .optional(),
    total_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((usage, context) => {
    const cached = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens;
    if ((cached ?? 0) > usage.prompt_tokens) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cached prompt tokens exceed prompt tokens.",
      });
    }
    if (
      usage.prompt_cache_hit_tokens !== undefined &&
      usage.prompt_tokens_details !== undefined &&
      usage.prompt_cache_hit_tokens !== usage.prompt_tokens_details.cached_tokens
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Cached token counts disagree." });
    }
    if (
      cached !== undefined &&
      usage.prompt_cache_miss_tokens !== undefined &&
      cached + usage.prompt_cache_miss_tokens !== usage.prompt_tokens
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prompt token count is inconsistent.",
      });
    }
    if (usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Total token count is inconsistent.",
      });
    }
  });

export function parseDeepSeekUsage(value: unknown) {
  const usage = providerUsageSchema.parse(value);
  return modelUsageSchema.parse({
    cachedInputTokens:
      usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  });
}

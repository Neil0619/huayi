import { z } from "zod";

import { deepSeekProviderError } from "./deepseek-provider-errors.js";
import { DEEPSEEK_MODEL } from "./deepseek-request-body.js";

const deltaSchema = z.strictObject({
  content: z.string().nullable().optional(),
  reasoning_content: z.string().nullable().optional(),
  role: z.literal("assistant").nullable().optional(),
});

const tokenCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.strictObject({
  completion_tokens: tokenCountSchema,
  completion_tokens_details: z
    .strictObject({ reasoning_tokens: tokenCountSchema.optional() })
    .optional(),
  prompt_cache_hit_tokens: tokenCountSchema.optional(),
  prompt_cache_miss_tokens: tokenCountSchema.optional(),
  prompt_tokens: tokenCountSchema,
  prompt_tokens_details: z.strictObject({ cached_tokens: tokenCountSchema }).optional(),
  total_tokens: tokenCountSchema,
});

const chunkSchema = z.strictObject({
  choices: z.tuple([
    z.strictObject({
      delta: deltaSchema,
      finish_reason: z
        .enum(["stop", "length", "content_filter", "tool_calls", "insufficient_system_resource"])
        .nullable(),
      index: z.literal(0),
      logprobs: z.null(),
    }),
  ]),
  created: z.number().int().nonnegative(),
  id: z.string().min(1).max(512),
  model: z.literal(DEEPSEEK_MODEL),
  object: z.literal("chat.completion.chunk"),
  system_fingerprint: z.string().min(1).max(512).optional(),
  usage: z.union([z.null(), usageSchema]).optional(),
});

export type DeepSeekChatEvent =
  | {
      readonly content: string | null;
      readonly created: number;
      readonly finishReason:
        "stop" | "length" | "content_filter" | "tool_calls" | "insufficient_system_resource" | null;
      readonly id: string;
      readonly reasoningContent: string | null;
      readonly role: "assistant" | null;
      readonly type: "chunk";
    }
  | { readonly type: "done" };

export function parseDeepSeekSseData(data: string): DeepSeekChatEvent {
  if (data === "[DONE]") return { type: "done" };
  let json: unknown;
  try {
    json = JSON.parse(data) as unknown;
  } catch {
    throw deepSeekProviderError("INVALID_RESPONSE");
  }
  const parsed = chunkSchema.safeParse(json);
  if (!parsed.success) throw deepSeekProviderError("INVALID_RESPONSE");
  const choice = parsed.data.choices[0];
  return {
    content: choice.delta.content ?? null,
    created: parsed.data.created,
    finishReason: choice.finish_reason,
    id: parsed.data.id,
    reasoningContent: choice.delta.reasoning_content ?? null,
    role: choice.delta.role ?? null,
    type: "chunk",
  };
}

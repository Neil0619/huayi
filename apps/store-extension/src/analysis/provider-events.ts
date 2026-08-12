import { z } from "zod/v3";

import { BrowserAnalysisError } from "./analysis-error.js";
import { DEEPSEEK_MODEL } from "./provider-requests.js";
import type { SseMessage } from "./sse-decoder.js";

const identifier = z.string().min(1).max(512);
const sequence = z.number().int().nonnegative();
const textPart = z.strictObject({
  annotations: z.array(z.never()),
  logprobs: z.array(z.unknown()).optional(),
  text: z.string(),
  type: z.literal("output_text"),
});
const doneItem = z.strictObject({
  content: z.tuple([textPart]),
  id: identifier,
  role: z.literal("assistant"),
  status: z.literal("completed"),
  type: z.literal("message"),
});
const addedItem = z.strictObject({
  content: z.tuple([]),
  id: identifier,
  role: z.literal("assistant"),
  status: z.literal("in_progress"),
  type: z.literal("message"),
});
const inProgressResponse = z.strictObject({
  error: z.null(),
  id: identifier,
  incomplete_details: z.null(),
  output: z.tuple([]),
  status: z.literal("in_progress"),
});
const completedResponse = z.strictObject({
  error: z.null(),
  id: identifier,
  incomplete_details: z.null(),
  output: z.tuple([doneItem]),
  status: z.literal("completed"),
});
const common = { sequence_number: sequence };
const openAiSchemas = {
  "response.completed": z.strictObject({
    ...common,
    response: completedResponse,
    type: z.literal("response.completed"),
  }),
  "response.content_part.added": z.strictObject({
    ...common,
    content_index: z.literal(0),
    item_id: identifier,
    output_index: z.literal(0),
    part: textPart,
    type: z.literal("response.content_part.added"),
  }),
  "response.content_part.done": z.strictObject({
    ...common,
    content_index: z.literal(0),
    item_id: identifier,
    output_index: z.literal(0),
    part: textPart,
    type: z.literal("response.content_part.done"),
  }),
  "response.created": z.strictObject({
    ...common,
    response: inProgressResponse,
    type: z.literal("response.created"),
  }),
  "response.in_progress": z.strictObject({
    ...common,
    response: inProgressResponse,
    type: z.literal("response.in_progress"),
  }),
  "response.output_item.added": z.strictObject({
    ...common,
    item: addedItem,
    output_index: z.literal(0),
    type: z.literal("response.output_item.added"),
  }),
  "response.output_item.done": z.strictObject({
    ...common,
    item: doneItem,
    output_index: z.literal(0),
    type: z.literal("response.output_item.done"),
  }),
  "response.output_text.delta": z.strictObject({
    ...common,
    content_index: z.literal(0),
    delta: z.string().min(1),
    item_id: identifier,
    logprobs: z.array(z.unknown()).optional(),
    output_index: z.literal(0),
    type: z.literal("response.output_text.delta"),
  }),
  "response.output_text.done": z.strictObject({
    ...common,
    content_index: z.literal(0),
    item_id: identifier,
    logprobs: z.array(z.unknown()).optional(),
    output_index: z.literal(0),
    text: z.string(),
    type: z.literal("response.output_text.done"),
  }),
} as const;

export type OpenAiEvent =
  | {
      readonly responseId: string;
      readonly sequence: number;
      readonly type: "created" | "in-progress";
    }
  | { readonly itemId: string; readonly sequence: number; readonly type: "item-added" }
  | {
      readonly itemId: string;
      readonly sequence: number;
      readonly text: string;
      readonly type: "part-added" | "text-delta" | "text-done" | "part-done" | "item-done";
    }
  | {
      readonly itemId: string;
      readonly responseId: string;
      readonly sequence: number;
      readonly text: string;
      readonly type: "completed";
    };

export function parseOpenAiEvent(message: SseMessage): OpenAiEvent {
  if (message.event === undefined || !Object.hasOwn(openAiSchemas, message.event)) {
    throw new BrowserAnalysisError("invalid-response");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(message.data);
  } catch {
    throw new BrowserAnalysisError("invalid-response");
  }
  const name = message.event as keyof typeof openAiSchemas;
  const parsed = openAiSchemas[name].safeParse(raw);
  if (!parsed.success) throw new BrowserAnalysisError("invalid-response");
  const event = parsed.data;
  switch (event.type) {
    case "response.created":
      return { responseId: event.response.id, sequence: event.sequence_number, type: "created" };
    case "response.in_progress":
      return {
        responseId: event.response.id,
        sequence: event.sequence_number,
        type: "in-progress",
      };
    case "response.output_item.added":
      return { itemId: event.item.id, sequence: event.sequence_number, type: "item-added" };
    case "response.content_part.added":
      return {
        itemId: event.item_id,
        sequence: event.sequence_number,
        text: event.part.text,
        type: "part-added",
      };
    case "response.output_text.delta":
      return {
        itemId: event.item_id,
        sequence: event.sequence_number,
        text: event.delta,
        type: "text-delta",
      };
    case "response.output_text.done":
      return {
        itemId: event.item_id,
        sequence: event.sequence_number,
        text: event.text,
        type: "text-done",
      };
    case "response.content_part.done":
      return {
        itemId: event.item_id,
        sequence: event.sequence_number,
        text: event.part.text,
        type: "part-done",
      };
    case "response.output_item.done":
      return {
        itemId: event.item.id,
        sequence: event.sequence_number,
        text: event.item.content[0].text,
        type: "item-done",
      };
    case "response.completed": {
      const item = event.response.output[0];
      return {
        itemId: item.id,
        responseId: event.response.id,
        sequence: event.sequence_number,
        text: item.content[0].text,
        type: "completed",
      };
    }
  }
}

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const deepSeekUsage = z.strictObject({
  completion_tokens: tokenCount,
  completion_tokens_details: z.strictObject({ reasoning_tokens: tokenCount.optional() }).optional(),
  prompt_cache_hit_tokens: tokenCount.optional(),
  prompt_cache_miss_tokens: tokenCount.optional(),
  prompt_tokens: tokenCount,
  prompt_tokens_details: z.strictObject({ cached_tokens: tokenCount }).optional(),
  total_tokens: tokenCount,
});

const deepSeekChunk = z.strictObject({
  choices: z.tuple([
    z.strictObject({
      delta: z.strictObject({
        content: z.string().nullable().optional(),
        reasoning_content: z.string().nullable().optional(),
        role: z.literal("assistant").nullable().optional(),
      }),
      finish_reason: z
        .enum(["stop", "length", "content_filter", "tool_calls", "insufficient_system_resource"])
        .nullable(),
      index: z.literal(0),
      logprobs: z.null(),
    }),
  ]),
  created: z.number().int().nonnegative(),
  id: identifier,
  model: z.literal(DEEPSEEK_MODEL),
  object: z.literal("chat.completion.chunk"),
  system_fingerprint: z.string().min(1).max(512).optional(),
  usage: z.union([z.null(), deepSeekUsage]).optional(),
});

export type DeepSeekEvent =
  | { readonly type: "done" }
  | {
      readonly content: string | null;
      readonly created: number;
      readonly finishReason: string | null;
      readonly id: string;
      readonly reasoning: string | null;
      readonly role: "assistant" | null;
      readonly type: "chunk";
    };

export function parseDeepSeekEvent(message: SseMessage): DeepSeekEvent {
  if (message.event !== undefined) throw new BrowserAnalysisError("invalid-response");
  if (message.data === "[DONE]") return { type: "done" };
  let raw: unknown;
  try {
    raw = JSON.parse(message.data);
  } catch {
    throw new BrowserAnalysisError("invalid-response");
  }
  const parsed = deepSeekChunk.safeParse(raw);
  if (!parsed.success) throw new BrowserAnalysisError("invalid-response");
  const choice = parsed.data.choices[0];
  return {
    content: choice.delta.content ?? null,
    created: parsed.data.created,
    finishReason: choice.finish_reason,
    id: parsed.data.id,
    reasoning: choice.delta.reasoning_content ?? null,
    role: choice.delta.role ?? null,
    type: "chunk",
  };
}

import { z } from "zod";

import { openAIProviderError } from "./openai-provider-errors.js";
import type { SseMessage } from "./sse-decoder.js";

const identifierSchema = z.string().min(1).max(512);
const sequenceNumberSchema = z.number().int().nonnegative();
const zeroIndexSchema = z.literal(0);

function responseSchema(status: "completed" | "failed" | "in_progress" | "incomplete") {
  return z.object({ id: identifierSchema, status: z.literal(status) });
}

const outputTextPartSchema = z.strictObject({
  annotations: z.array(z.never()),
  logprobs: z.array(z.unknown()).optional(),
  text: z.string(),
  type: z.literal("output_text"),
});

const messageAddedSchema = z.strictObject({
  content: z.tuple([]),
  id: identifierSchema,
  role: z.literal("assistant"),
  status: z.literal("in_progress"),
  type: z.literal("message"),
});

const messageDoneSchema = z.strictObject({
  content: z.tuple([outputTextPartSchema]),
  id: identifierSchema,
  role: z.literal("assistant"),
  status: z.literal("completed"),
  type: z.literal("message"),
});

const schemas = {
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    param: z.string().nullable(),
    sequence_number: sequenceNumberSchema,
    type: z.literal("error"),
  }),
  "response.completed": z.strictObject({
    response: responseSchema("completed"),
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.completed"),
  }),
  "response.content_part.added": z.strictObject({
    content_index: zeroIndexSchema,
    item_id: identifierSchema,
    output_index: zeroIndexSchema,
    part: outputTextPartSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.content_part.added"),
  }),
  "response.content_part.done": z.strictObject({
    content_index: zeroIndexSchema,
    item_id: identifierSchema,
    output_index: zeroIndexSchema,
    part: outputTextPartSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.content_part.done"),
  }),
  "response.created": z.strictObject({
    response: responseSchema("in_progress"),
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.created"),
  }),
  "response.failed": z.strictObject({
    response: responseSchema("failed"),
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.failed"),
  }),
  "response.in_progress": z.strictObject({
    response: responseSchema("in_progress"),
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.in_progress"),
  }),
  "response.incomplete": z.strictObject({
    response: responseSchema("incomplete"),
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.incomplete"),
  }),
  "response.output_item.added": z.strictObject({
    item: messageAddedSchema,
    output_index: zeroIndexSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.output_item.added"),
  }),
  "response.output_item.done": z.strictObject({
    item: messageDoneSchema,
    output_index: zeroIndexSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.output_item.done"),
  }),
  "response.output_text.delta": z.strictObject({
    content_index: zeroIndexSchema,
    delta: z.string().min(1),
    item_id: identifierSchema,
    logprobs: z.array(z.unknown()).optional(),
    output_index: zeroIndexSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.output_text.delta"),
  }),
  "response.output_text.done": z.strictObject({
    content_index: zeroIndexSchema,
    item_id: identifierSchema,
    output_index: zeroIndexSchema,
    sequence_number: sequenceNumberSchema,
    text: z.string(),
    logprobs: z.array(z.unknown()).optional(),
    type: z.literal("response.output_text.done"),
  }),
} as const;

type EventName = keyof typeof schemas;

export type OpenAIResponseEvent =
  | { type: "error" }
  | { type: "response.completed" }
  | { itemId: string; text: string; type: "response.content_part.added" }
  | { itemId: string; text: string; type: "response.content_part.done" }
  | { type: "response.created" }
  | { type: "response.failed" }
  | { type: "response.in_progress" }
  | { type: "response.incomplete" }
  | { itemId: string; type: "response.output_item.added" }
  | { itemId: string; type: "response.output_item.done" }
  | { delta: string; itemId: string; type: "response.output_text.delta" }
  | { itemId: string; text: string; type: "response.output_text.done" };

function isEventName(value: string): value is EventName {
  return Object.hasOwn(schemas, value);
}

export function parseOpenAIResponseEvent(message: SseMessage): OpenAIResponseEvent {
  if (!isEventName(message.event)) {
    throw openAIProviderError("INVALID_RESPONSE");
  }

  let json: unknown;
  try {
    json = JSON.parse(message.data) as unknown;
  } catch (error) {
    throw openAIProviderError("INVALID_RESPONSE", error);
  }

  let event: z.infer<(typeof schemas)[EventName]>;
  try {
    event = schemas[message.event].parse(json);
  } catch (error) {
    throw openAIProviderError("INVALID_RESPONSE", error);
  }

  switch (event.type) {
    case "response.output_item.added":
    case "response.output_item.done":
      return { itemId: event.item.id, type: event.type };
    case "response.content_part.added":
    case "response.content_part.done":
      return { itemId: event.item_id, text: event.part.text, type: event.type };
    case "response.output_text.delta":
      return { delta: event.delta, itemId: event.item_id, type: event.type };
    case "response.output_text.done":
      return { itemId: event.item_id, text: event.text, type: event.type };
    case "error":
    case "response.completed":
    case "response.created":
    case "response.failed":
    case "response.in_progress":
    case "response.incomplete":
      return { type: event.type };
  }
}

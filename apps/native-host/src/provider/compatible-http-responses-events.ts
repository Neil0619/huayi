import { z } from "zod";

import type { SseMessage } from "./sse-decoder.js";

const INVALID_EVENT_MESSAGE = "Invalid compatible Responses event.";
const MAXIMUM_IDENTIFIER_LENGTH = 512;
const MAXIMUM_MODEL_TEXT_LENGTH = 1024 * 1024;

const identifierSchema = z.string().min(1).max(MAXIMUM_IDENTIFIER_LENGTH);
const sequenceNumberSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const boundedMetadataNumberSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
const zeroIndexSchema = z.literal(0);

const outputTextPartSchema = z.strictObject({
  annotations: z.tuple([]),
  text: z.string().max(MAXIMUM_MODEL_TEXT_LENGTH),
  type: z.literal("output_text"),
});

const reasoningItemSchema = z.strictObject({
  id: identifierSchema,
  summary: z.tuple([]),
  type: z.literal("reasoning"),
});

const assistantAddedItemSchema = z.strictObject({
  content: z.tuple([]),
  id: identifierSchema,
  role: z.literal("assistant"),
  status: z.literal("in_progress"),
  type: z.literal("message"),
});

const assistantCompletedItemSchema = z.strictObject({
  content: z.tuple([outputTextPartSchema]),
  id: identifierSchema,
  role: z.literal("assistant"),
  status: z.literal("completed"),
  type: z.literal("message"),
});

const inProgressResponseSchema = z.strictObject({
  error: z.null(),
  id: identifierSchema,
  incomplete_details: z.null(),
  output: z.tuple([]),
  status: z.literal("in_progress"),
});

const completedResponseSchema = z.strictObject({
  error: z.null(),
  id: identifierSchema,
  incomplete_details: z.null(),
  output: z.tuple([assistantCompletedItemSchema]),
  status: z.literal("completed"),
});

const responseOutputItemAddedBase = {
  output_index: zeroIndexSchema,
  sequence_number: sequenceNumberSchema,
  type: z.literal("response.output_item.added"),
} as const;

const schemas = {
  "codex.rate_limits": z.strictObject({
    rate_limits: z.strictObject({
      primary: boundedMetadataNumberSchema,
      secondary: boundedMetadataNumberSchema,
    }),
    type: z.literal("codex.rate_limits"),
  }),
  "response.completed": z.strictObject({
    response: completedResponseSchema,
    sequence_number: sequenceNumberSchema.optional(),
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
  "response.created": z.strictObject({
    response: inProgressResponseSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.created"),
  }),
  "response.in_progress": z.strictObject({
    response: inProgressResponseSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.in_progress"),
  }),
  "response.output_item.added": z.union([
    z.strictObject({ item: reasoningItemSchema, ...responseOutputItemAddedBase }),
    z.strictObject({ item: assistantAddedItemSchema, ...responseOutputItemAddedBase }),
  ]),
  "response.output_item.done": z.strictObject({
    item: reasoningItemSchema,
    output_index: zeroIndexSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.output_item.done"),
  }),
  "response.output_text.delta": z.strictObject({
    content_index: zeroIndexSchema,
    delta: z.string().min(1).max(MAXIMUM_MODEL_TEXT_LENGTH),
    item_id: identifierSchema,
    output_index: zeroIndexSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.output_text.delta"),
  }),
  "response.output_text.done": z.strictObject({
    content_index: zeroIndexSchema,
    item_id: identifierSchema,
    output_index: zeroIndexSchema,
    sequence_number: sequenceNumberSchema,
    text: z.string().max(MAXIMUM_MODEL_TEXT_LENGTH),
    type: z.literal("response.output_text.done"),
  }),
} as const;

interface CompatibleSequence {
  sequence: number | null;
}
type EventName = keyof typeof schemas;

export type CompatibleHttpResponseEvent = CompatibleSequence &
  (
    | { type: "codex.rate_limits" }
    | { responseId: string; type: "response.created" | "response.in_progress" }
    | {
        itemId: string;
        itemType: "reasoning" | "message";
        type: "response.output_item.added";
      }
    | { itemId: string; itemType: "reasoning"; type: "response.output_item.done" }
    | { itemId: string; text: string; type: "response.content_part.added" }
    | { delta: string; itemId: string; type: "response.output_text.delta" }
    | { itemId: string; text: string; type: "response.output_text.done" }
    | { itemId: string; responseId: string; text: string; type: "response.completed" }
  );

function invalidEvent(): Error {
  return new Error(INVALID_EVENT_MESSAGE);
}

function isEventName(value: string): value is EventName {
  return Object.hasOwn(schemas, value);
}

export function parseCompatibleHttpResponseEvent(message: SseMessage): CompatibleHttpResponseEvent {
  if (!isEventName(message.event)) {
    throw invalidEvent();
  }

  let json: unknown;
  try {
    json = JSON.parse(message.data) as unknown;
  } catch {
    throw invalidEvent();
  }

  let event: z.infer<(typeof schemas)[EventName]>;
  try {
    event = schemas[message.event].parse(json);
  } catch {
    throw invalidEvent();
  }

  if (event.type !== message.event) {
    throw invalidEvent();
  }

  switch (event.type) {
    case "codex.rate_limits":
      return { sequence: null, type: event.type };
    case "response.created":
    case "response.in_progress":
      return {
        responseId: event.response.id,
        sequence: event.sequence_number,
        type: event.type,
      };
    case "response.output_item.added":
      return {
        itemId: event.item.id,
        itemType: event.item.type,
        sequence: event.sequence_number,
        type: event.type,
      };
    case "response.output_item.done":
      return {
        itemId: event.item.id,
        itemType: event.item.type,
        sequence: event.sequence_number,
        type: event.type,
      };
    case "response.content_part.added":
      return {
        itemId: event.item_id,
        sequence: event.sequence_number,
        text: event.part.text,
        type: event.type,
      };
    case "response.output_text.delta":
      return {
        delta: event.delta,
        itemId: event.item_id,
        sequence: event.sequence_number,
        type: event.type,
      };
    case "response.output_text.done":
      return {
        itemId: event.item_id,
        sequence: event.sequence_number,
        text: event.text,
        type: event.type,
      };
    case "response.completed": {
      const item = event.response.output[0];
      return {
        itemId: item.id,
        responseId: event.response.id,
        sequence: event.sequence_number ?? null,
        text: item.content[0].text,
        type: event.type,
      };
    }
  }
}

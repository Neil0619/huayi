import { z } from "zod";

import {
  compatibleAssistantAddedItemSchema,
  compatibleAssistantDoneItemSchema,
  compatibleCompletedResponseSchema,
  compatibleIdentifierSchema,
  compatibleInProgressResponseSchema,
  compatibleOutputTextPartSchema,
  compatibleReasoningItemSchema,
} from "./compatible-http-response-shapes.js";
import type { SseMessage } from "./sse-decoder.js";

const INVALID_EVENT_MESSAGE = "Invalid compatible Responses event.";
const MAXIMUM_MODEL_TEXT_LENGTH = 1024 * 1024;

const sequenceNumberSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const boundedMetadataNumberSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
const zeroIndexSchema = z.literal(0);
const outputIndexSchema = z.union([zeroIndexSchema, z.literal(1)]);

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
    response: compatibleCompletedResponseSchema,
    sequence_number: sequenceNumberSchema.optional(),
    type: z.literal("response.completed"),
  }),
  "response.content_part.added": z.strictObject({
    content_index: zeroIndexSchema,
    item_id: compatibleIdentifierSchema,
    output_index: outputIndexSchema,
    part: compatibleOutputTextPartSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.content_part.added"),
  }),
  "response.content_part.done": z.strictObject({
    content_index: zeroIndexSchema,
    item_id: compatibleIdentifierSchema,
    output_index: outputIndexSchema,
    part: compatibleOutputTextPartSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.content_part.done"),
  }),
  "response.created": z.strictObject({
    response: compatibleInProgressResponseSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.created"),
  }),
  "response.in_progress": z.strictObject({
    response: compatibleInProgressResponseSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.in_progress"),
  }),
  "response.output_item.added": z.union([
    z.strictObject({ item: compatibleReasoningItemSchema, ...responseOutputItemAddedBase }),
    z.strictObject({
      item: compatibleAssistantAddedItemSchema,
      ...responseOutputItemAddedBase,
      output_index: outputIndexSchema,
    }),
  ]),
  "response.output_item.done": z.union([
    z.strictObject({
      item: compatibleReasoningItemSchema,
      output_index: zeroIndexSchema,
      sequence_number: sequenceNumberSchema,
      type: z.literal("response.output_item.done"),
    }),
    z.strictObject({
      item: compatibleAssistantDoneItemSchema,
      output_index: outputIndexSchema,
      sequence_number: sequenceNumberSchema,
      type: z.literal("response.output_item.done"),
    }),
  ]),
  "response.output_text.delta": z.strictObject({
    content_index: zeroIndexSchema,
    delta: z.string().min(1).max(MAXIMUM_MODEL_TEXT_LENGTH),
    item_id: compatibleIdentifierSchema,
    logprobs: z.tuple([]).optional(),
    obfuscation: z.string().min(1).max(MAXIMUM_MODEL_TEXT_LENGTH).optional(),
    output_index: outputIndexSchema,
    sequence_number: sequenceNumberSchema,
    type: z.literal("response.output_text.delta"),
  }),
  "response.output_text.done": z.strictObject({
    content_index: zeroIndexSchema,
    item_id: compatibleIdentifierSchema,
    logprobs: z.tuple([]).optional(),
    output_index: outputIndexSchema,
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
        outputIndex: 0 | 1;
        type: "response.output_item.added";
      }
    | {
        itemId: string;
        itemType: "message" | "reasoning";
        outputIndex: 0 | 1;
        text: string | null;
        type: "response.output_item.done";
      }
    | {
        itemId: string;
        outputIndex: 0 | 1;
        text: string;
        type: "response.content_part.added" | "response.content_part.done";
      }
    | { delta: string; itemId: string; outputIndex: 0 | 1; type: "response.output_text.delta" }
    | { itemId: string; outputIndex: 0 | 1; text: string; type: "response.output_text.done" }
    | { itemId: string | null; responseId: string; text: string; type: "response.completed" }
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
        outputIndex: event.output_index,
        sequence: event.sequence_number,
        type: event.type,
      };
    case "response.output_item.done":
      return {
        itemId: event.item.id,
        itemType: event.item.type,
        outputIndex: event.output_index,
        sequence: event.sequence_number,
        text: event.item.type === "message" ? event.item.content[0].text : null,
        type: event.type,
      };
    case "response.content_part.added":
    case "response.content_part.done":
      return {
        itemId: event.item_id,
        outputIndex: event.output_index,
        sequence: event.sequence_number,
        text: event.part.text,
        type: event.type,
      };
    case "response.output_text.delta":
      return {
        delta: event.delta,
        itemId: event.item_id,
        outputIndex: event.output_index,
        sequence: event.sequence_number,
        type: event.type,
      };
    case "response.output_text.done":
      return {
        itemId: event.item_id,
        outputIndex: event.output_index,
        sequence: event.sequence_number,
        text: event.text,
        type: event.type,
      };
    case "response.completed": {
      const item =
        event.response.output.length === 2 ? event.response.output[1] : event.response.output[0];
      return {
        itemId: "id" in item && typeof item.id === "string" ? item.id : null,
        responseId: event.response.id,
        sequence: event.sequence_number ?? null,
        text: item.content[0].text,
        type: event.type,
      };
    }
  }
}

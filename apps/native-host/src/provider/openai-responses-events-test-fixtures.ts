import type { SseMessage } from "./sse-decoder.js";

export const responseId = "resp_test";
export const itemId = "msg_test";

export const outputTextPart = {
  annotations: [],
  text: '{"translation":"调查"}',
  type: "output_text",
} as const;

export const completedMessage = {
  content: [outputTextPart],
  id: itemId,
  role: "assistant",
  status: "completed",
  type: "message",
} as const;

export const fixtures = {
  "response.completed": {
    response: {
      error: null,
      id: responseId,
      incomplete_details: null,
      output: [completedMessage],
      status: "completed",
      usage: { output_tokens: 12 },
    },
    sequence_number: 10,
    type: "response.completed",
  },
  "response.content_part.added": {
    content_index: 0,
    item_id: itemId,
    output_index: 0,
    part: { annotations: [], text: "", type: "output_text" },
    sequence_number: 4,
    type: "response.content_part.added",
  },
  "response.content_part.done": {
    content_index: 0,
    item_id: itemId,
    output_index: 0,
    part: outputTextPart,
    sequence_number: 8,
    type: "response.content_part.done",
  },
  "response.created": {
    response: {
      created_at: 1_700_000_000,
      error: null,
      id: responseId,
      incomplete_details: null,
      output: [],
      status: "in_progress",
    },
    sequence_number: 0,
    type: "response.created",
  },
  "response.failed": {
    response: {
      error: { code: "server_error", message: "generation failed" },
      id: responseId,
      incomplete_details: null,
      output: [],
      status: "failed",
    },
    sequence_number: 10,
    type: "response.failed",
  },
  "response.in_progress": {
    response: {
      error: null,
      id: responseId,
      incomplete_details: null,
      model: "test-model",
      output: [],
      status: "in_progress",
    },
    sequence_number: 1,
    type: "response.in_progress",
  },
  "response.incomplete": {
    response: {
      error: null,
      id: responseId,
      incomplete_details: { reason: "max_output_tokens" },
      output: [],
      status: "incomplete",
    },
    sequence_number: 10,
    type: "response.incomplete",
  },
  "response.output_item.added": {
    item: {
      content: [],
      id: itemId,
      role: "assistant",
      status: "in_progress",
      type: "message",
    },
    output_index: 0,
    sequence_number: 3,
    type: "response.output_item.added",
  },
  "response.output_item.done": {
    item: completedMessage,
    output_index: 0,
    sequence_number: 9,
    type: "response.output_item.done",
  },
  "response.output_text.delta": {
    content_index: 0,
    delta: '{"translation":',
    item_id: itemId,
    logprobs: [],
    output_index: 0,
    sequence_number: 5,
    type: "response.output_text.delta",
  },
  "response.output_text.done": {
    content_index: 0,
    item_id: itemId,
    output_index: 0,
    sequence_number: 7,
    text: outputTextPart.text,
    type: "response.output_text.done",
  },
  error: {
    code: "server_error",
    message: "stream failed",
    param: null,
    sequence_number: 11,
    type: "error",
  },
} as const;

export type EventName = keyof typeof fixtures;

export function message(event: EventName, data: unknown = fixtures[event]): SseMessage {
  return { data: JSON.stringify(data), event };
}

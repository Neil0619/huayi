import type { SseMessage } from "./sse-decoder.js";

export const compatibleResponseId = "resp_compatible_test";
export const compatibleReasoningItemId = "rs_compatible_test";
export const compatibleAssistantItemId = "msg_compatible_test";
export const compatibleOutputText = '{"translation":"测试"}';

export const rateLimitsFixture = {
  rate_limits: {
    primary: 0,
    secondary: null,
  },
  type: "codex.rate_limits",
} as const;

const inProgressResponseFixture = {
  error: null,
  id: compatibleResponseId,
  incomplete_details: null,
  output: [],
  status: "in_progress",
} as const;

export const createdFixture = {
  response: inProgressResponseFixture,
  sequence_number: 0,
  type: "response.created",
} as const;

export const inProgressFixture = {
  response: inProgressResponseFixture,
  sequence_number: 1,
  type: "response.in_progress",
} as const;

const reasoningItemFixture = {
  id: compatibleReasoningItemId,
  summary: [],
  type: "reasoning",
} as const;

export const reasoningAddedFixture = {
  item: reasoningItemFixture,
  output_index: 0,
  sequence_number: 2,
  type: "response.output_item.added",
} as const;

export const reasoningDoneFixture = {
  item: reasoningItemFixture,
  output_index: 0,
  sequence_number: 3,
  type: "response.output_item.done",
} as const;

const assistantAddedItemFixture = {
  content: [],
  id: compatibleAssistantItemId,
  role: "assistant",
  status: "in_progress",
  type: "message",
} as const;

export const assistantAddedFixture = {
  item: assistantAddedItemFixture,
  output_index: 0,
  sequence_number: 4,
  type: "response.output_item.added",
} as const;

export const partAddedFixture = {
  content_index: 0,
  item_id: compatibleAssistantItemId,
  output_index: 0,
  part: {
    annotations: [],
    text: "",
    type: "output_text",
  },
  sequence_number: 5,
  type: "response.content_part.added",
} as const;

export const firstDeltaFixture = {
  content_index: 0,
  delta: '{"translation":',
  item_id: compatibleAssistantItemId,
  output_index: 0,
  sequence_number: 6,
  type: "response.output_text.delta",
} as const;

export const secondDeltaFixture = {
  content_index: 0,
  delta: '"测试"}',
  item_id: compatibleAssistantItemId,
  output_index: 0,
  sequence_number: 7,
  type: "response.output_text.delta",
} as const;

export const textDoneFixture = {
  content_index: 0,
  item_id: compatibleAssistantItemId,
  output_index: 0,
  sequence_number: 8,
  text: compatibleOutputText,
  type: "response.output_text.done",
} as const;

export const completedMessageFixture = {
  content: [
    {
      annotations: [],
      text: compatibleOutputText,
      type: "output_text",
    },
  ],
  id: compatibleAssistantItemId,
  role: "assistant",
  status: "completed",
  type: "message",
} as const;

export const completedFixture = {
  response: {
    error: null,
    id: compatibleResponseId,
    incomplete_details: null,
    output: [completedMessageFixture],
    status: "completed",
  },
  type: "response.completed",
} as const;

export function compatibleMessage(event: string, value: unknown): SseMessage {
  return { data: JSON.stringify(value), event };
}

export const compatibleLifecycleMessages: readonly SseMessage[] = [
  compatibleMessage("codex.rate_limits", rateLimitsFixture),
  compatibleMessage("response.created", createdFixture),
  compatibleMessage("response.in_progress", inProgressFixture),
  compatibleMessage("response.output_item.added", reasoningAddedFixture),
  compatibleMessage("response.output_item.done", reasoningDoneFixture),
  compatibleMessage("response.output_item.added", assistantAddedFixture),
  compatibleMessage("response.content_part.added", partAddedFixture),
  compatibleMessage("response.output_text.delta", firstDeltaFixture),
  compatibleMessage("response.output_text.delta", secondDeltaFixture),
  compatibleMessage("response.output_text.done", textDoneFixture),
  compatibleMessage("response.completed", completedFixture),
];

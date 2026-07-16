import type { SseMessage } from "./sse-decoder.js";

import {
  compatibleAssistantItemId,
  compatibleMessage,
  compatibleOutputText,
  compatibleReasoningItemId,
  compatibleResponseId,
} from "./compatible-http-responses-events-test-fixtures.js";

const outputSchema = {
  additionalProperties: false,
  properties: { translation: { type: "string" } },
  required: ["translation"],
  type: "object",
} as const;

function fullResponse(
  status: "completed" | "in_progress",
  output: readonly unknown[],
  completedAt: number | null,
  usage: object | null,
) {
  return {
    background: false,
    completed_at: completedAt,
    created_at: 1_721_234_567,
    error: null,
    frequency_penalty: 0,
    id: compatibleResponseId,
    incomplete_details: null,
    instructions: "Analyze the provided fixture text.",
    max_output_tokens: null,
    max_tool_calls: null,
    metadata: {},
    model: "gpt-5.4",
    moderation: null,
    object: "response",
    output,
    parallel_tool_calls: true,
    presence_penalty: 0,
    previous_response_id: null,
    prompt_cache_key: "fixture-cache-key",
    prompt_cache_retention: "24h",
    reasoning: {
      context: "fixture",
      effort: "low",
      mode: "summary",
      summary: null,
    },
    safety_identifier: "fixture-safety-id",
    service_tier: "default",
    status,
    store: false,
    temperature: 1,
    text: {
      format: {
        description: null,
        name: "translate_lexical",
        schema: outputSchema,
        strict: true,
        type: "json_schema",
      },
      verbosity: "medium",
    },
    tool_choice: "auto",
    tool_usage: {
      image_gen: {
        input_tokens: 0,
        input_tokens_details: { image_tokens: 0, text_tokens: 0 },
        output_tokens: 0,
        output_tokens_details: { image_tokens: 0, text_tokens: 0 },
        total_tokens: 0,
      },
      web_search: { num_requests: 0 },
    },
    tools: [],
    top_logprobs: 0,
    top_p: 1,
    truncation: "disabled",
    usage,
    user: null,
  } as const;
}

const reasoningItem = {
  content: [],
  encrypted_content: "opaque-fixture-reasoning",
  id: compatibleReasoningItemId,
  internal_chat_message_metadata_passthrough: { turn_id: "fixture-turn-id" },
  metadata: { turn_id: "fixture-turn-id" },
  summary: [],
  type: "reasoning",
} as const;

export const gatewayReasoningAddedFixture = {
  item: reasoningItem,
  output_index: 0,
  sequence_number: 2,
  type: "response.output_item.added",
} as const;

const assistantAdded = {
  item: {
    content: [],
    id: compatibleAssistantItemId,
    internal_chat_message_metadata_passthrough: { turn_id: "fixture-turn-id" },
    metadata: { turn_id: "fixture-turn-id" },
    phase: "final_answer",
    role: "assistant",
    status: "in_progress",
    type: "message",
  },
  output_index: 1,
  sequence_number: 4,
  type: "response.output_item.added",
} as const;

const completedPart = {
  annotations: [],
  logprobs: [],
  text: compatibleOutputText,
  type: "output_text",
} as const;

const assistantDoneItem = {
  content: [completedPart],
  id: compatibleAssistantItemId,
  internal_chat_message_metadata_passthrough: { turn_id: "fixture-turn-id" },
  metadata: { turn_id: "fixture-turn-id" },
  phase: "final_answer",
  role: "assistant",
  status: "completed",
  type: "message",
} as const;

export const gatewayLifecycleMessages: readonly SseMessage[] = [
  compatibleMessage("response.created", {
    response: fullResponse("in_progress", [], null, null),
    sequence_number: 0,
    type: "response.created",
  }),
  compatibleMessage("response.in_progress", {
    response: fullResponse("in_progress", [], null, null),
    sequence_number: 1,
    type: "response.in_progress",
  }),
  compatibleMessage("response.output_item.added", gatewayReasoningAddedFixture),
  compatibleMessage("response.output_item.done", {
    ...gatewayReasoningAddedFixture,
    sequence_number: 3,
    type: "response.output_item.done",
  }),
  compatibleMessage("response.output_item.added", assistantAdded),
  compatibleMessage("response.content_part.added", {
    content_index: 0,
    item_id: compatibleAssistantItemId,
    output_index: 1,
    part: { annotations: [], logprobs: [], text: "", type: "output_text" },
    sequence_number: 5,
    type: "response.content_part.added",
  }),
  compatibleMessage("response.output_text.delta", {
    content_index: 0,
    delta: '{"translation":',
    item_id: compatibleAssistantItemId,
    logprobs: [],
    obfuscation: "opaque-fixture-padding",
    output_index: 1,
    sequence_number: 6,
    type: "response.output_text.delta",
  }),
  compatibleMessage("response.output_text.delta", {
    content_index: 0,
    delta: '"测试"}',
    item_id: compatibleAssistantItemId,
    logprobs: [],
    obfuscation: "opaque-fixture-padding",
    output_index: 1,
    sequence_number: 7,
    type: "response.output_text.delta",
  }),
  compatibleMessage("response.output_text.done", {
    content_index: 0,
    item_id: compatibleAssistantItemId,
    logprobs: [],
    output_index: 1,
    sequence_number: 8,
    text: compatibleOutputText,
    type: "response.output_text.done",
  }),
  compatibleMessage("response.content_part.done", {
    content_index: 0,
    item_id: compatibleAssistantItemId,
    output_index: 1,
    part: completedPart,
    sequence_number: 9,
    type: "response.content_part.done",
  }),
  compatibleMessage("response.output_item.done", {
    item: assistantDoneItem,
    output_index: 1,
    sequence_number: 10,
    type: "response.output_item.done",
  }),
  compatibleMessage("response.completed", {
    response: fullResponse("completed", [reasoningItem, assistantDoneItem], 1_721_234_568, {
      input_tokens: 42,
      input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
      output_tokens: 12,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 54,
    }),
    sequence_number: 11,
    type: "response.completed",
  }),
];

export const gatewayNoIdCompletedMessage = compatibleMessage("response.completed", {
  response: fullResponse(
    "completed",
    [
      {
        content: [{ text: compatibleOutputText, type: "output_text" }],
        role: "assistant",
        type: "message",
      },
    ],
    1_721_234_568,
    {
      input_tokens: 42,
      input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
      output_tokens: 12,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 54,
    },
  ),
  sequence_number: 11,
  type: "response.completed",
});

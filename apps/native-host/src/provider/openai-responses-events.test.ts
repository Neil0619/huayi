import { describe, expect, it } from "vitest";

import type { SseMessage } from "./sse-decoder.js";
import { parseOpenAIResponseEvent } from "./openai-responses-events.js";

const responseId = "resp_test";
const itemId = "msg_test";

const outputTextPart = {
  annotations: [],
  text: '{"translation":"调查"}',
  type: "output_text",
} as const;

const fixtures = {
  "response.completed": {
    response: { id: responseId, status: "completed", usage: { output_tokens: 12 } },
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
    response: { created_at: 1_700_000_000, id: responseId, status: "in_progress" },
    sequence_number: 0,
    type: "response.created",
  },
  "response.failed": {
    response: {
      error: { code: "server_error", message: "generation failed" },
      id: responseId,
      status: "failed",
    },
    sequence_number: 10,
    type: "response.failed",
  },
  "response.in_progress": {
    response: { id: responseId, model: "test-model", status: "in_progress" },
    sequence_number: 1,
    type: "response.in_progress",
  },
  "response.incomplete": {
    response: {
      id: responseId,
      incomplete_details: { reason: "max_output_tokens" },
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
    item: {
      content: [outputTextPart],
      id: itemId,
      role: "assistant",
      status: "completed",
      type: "message",
    },
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

type EventName = keyof typeof fixtures;

function message(event: EventName, data: unknown = fixtures[event]): SseMessage {
  return { data: JSON.stringify(data), event };
}

describe("parseOpenAIResponseEvent", () => {
  it.each(Object.keys(fixtures) as EventName[])("accepts and narrows %s", (eventName) => {
    const parsed = parseOpenAIResponseEvent(message(eventName));

    expect(parsed.type).toBe(eventName);
    expect(JSON.stringify(parsed)).not.toContain(responseId);
    expect(JSON.stringify(parsed)).not.toContain("output_tokens");
  });

  it("preserves only lifecycle fields consumed by the provider", () => {
    expect(parseOpenAIResponseEvent(message("response.created"))).toEqual({
      type: "response.created",
    });
    expect(parseOpenAIResponseEvent(message("response.output_item.added"))).toEqual({
      itemId,
      type: "response.output_item.added",
    });
    expect(parseOpenAIResponseEvent(message("response.content_part.done"))).toEqual({
      itemId,
      text: outputTextPart.text,
      type: "response.content_part.done",
    });
    expect(parseOpenAIResponseEvent(message("response.output_text.delta"))).toEqual({
      delta: '{"translation":',
      itemId,
      type: "response.output_text.delta",
    });
    expect(parseOpenAIResponseEvent(message("response.output_text.done"))).toEqual({
      itemId,
      text: outputTextPart.text,
      type: "response.output_text.done",
    });
  });

  it.each(Object.keys(fixtures) as EventName[])(
    "rejects unknown top-level fields on %s",
    (name) => {
      expect(() =>
        parseOpenAIResponseEvent(message(name, { ...fixtures[name], unexpected: true })),
      ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
    },
  );

  it("allows documented response metadata that the lifecycle does not consume", () => {
    const completed = fixtures["response.completed"];
    expect(
      parseOpenAIResponseEvent(
        message("response.completed", {
          ...completed,
          response: {
            ...completed.response,
            created_at: 1_700_000_000,
            metadata: { trace: "safe-to-ignore" },
            model: "test-model",
            output: [],
          },
        }),
      ),
    ).toEqual({ type: "response.completed" });
  });

  it("accepts documented optional logprobs without retaining them", () => {
    const delta = fixtures["response.output_text.delta"];
    const deltaWithoutLogprobs = Object.fromEntries(
      Object.entries(delta).filter(([key]) => key !== "logprobs"),
    );
    expect(
      parseOpenAIResponseEvent(message("response.output_text.delta", deltaWithoutLogprobs)),
    ).toEqual({ delta: delta.delta, itemId, type: "response.output_text.delta" });

    const done = fixtures["response.output_text.done"];
    expect(
      parseOpenAIResponseEvent(
        message("response.output_text.done", { ...done, logprobs: [{ token: "safe" }] }),
      ),
    ).toEqual({ itemId, text: done.text, type: "response.output_text.done" });

    const itemDone = fixtures["response.output_item.done"];
    expect(
      parseOpenAIResponseEvent(
        message("response.output_item.done", {
          ...itemDone,
          item: {
            ...itemDone.item,
            content: [{ ...outputTextPart, logprobs: [{ token: "safe" }] }],
          },
        }),
      ),
    ).toEqual({ itemId, type: "response.output_item.done" });
  });

  it("rejects unknown events and event/data type mismatches", () => {
    expect(() =>
      parseOpenAIResponseEvent({ data: JSON.stringify(fixtures["response.created"]), event: "x" }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
    expect(() =>
      parseOpenAIResponseEvent(
        message("response.created", { ...fixtures["response.created"], type: "response.failed" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });

  it.each(["not-json", "null", "[]", "42"])("rejects malformed JSON data: %s", (data) => {
    expect(() => parseOpenAIResponseEvent({ data, event: "response.created" })).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );
  });

  it.each([
    "response.output_item.added",
    "response.output_item.done",
    "response.content_part.added",
    "response.content_part.done",
    "response.output_text.delta",
    "response.output_text.done",
  ] as const)("rejects nonzero output_index on %s", (eventName) => {
    expect(() =>
      parseOpenAIResponseEvent(message(eventName, { ...fixtures[eventName], output_index: 1 })),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });

  it.each([
    "response.content_part.added",
    "response.content_part.done",
    "response.output_text.delta",
    "response.output_text.done",
  ] as const)("rejects nonzero content_index on %s", (eventName) => {
    expect(() =>
      parseOpenAIResponseEvent(message(eventName, { ...fixtures[eventName], content_index: 1 })),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });

  it.each(["reasoning", "function_call", "web_search_call"])(
    "rejects the output item type %s",
    (type) => {
      const source = fixtures["response.output_item.added"];
      expect(() =>
        parseOpenAIResponseEvent(
          message("response.output_item.added", {
            ...source,
            item: { ...source.item, type },
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
    },
  );

  it("rejects refusal and reasoning content parts", () => {
    const source = fixtures["response.content_part.added"];
    for (const part of [
      { refusal: "I cannot help.", type: "refusal" },
      { text: "hidden reasoning", type: "reasoning_text" },
    ]) {
      expect(() =>
        parseOpenAIResponseEvent(message("response.content_part.added", { ...source, part })),
      ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
    }
  });

  it("rejects an empty text delta", () => {
    expect(() =>
      parseOpenAIResponseEvent(
        message("response.output_text.delta", {
          ...fixtures["response.output_text.delta"],
          delta: "",
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });

  it("rejects wrong lifecycle statuses and malformed message items", () => {
    const completed = fixtures["response.completed"];
    expect(() =>
      parseOpenAIResponseEvent(
        message("response.completed", {
          ...completed,
          response: { ...completed.response, status: "in_progress" },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));

    const itemDone = fixtures["response.output_item.done"];
    expect(() =>
      parseOpenAIResponseEvent(
        message("response.output_item.done", {
          ...itemDone,
          item: { ...itemDone.item, role: "user" },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });
});

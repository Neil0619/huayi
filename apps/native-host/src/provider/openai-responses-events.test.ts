import { describe, expect, it } from "vitest";

import {
  completedMessage,
  type EventName,
  fixtures,
  itemId,
  message,
  outputTextPart,
  responseId,
} from "./openai-responses-events-test-fixtures.js";
import { parseOpenAIResponseEvent } from "./openai-responses-events.js";

describe("parseOpenAIResponseEvent", () => {
  it.each(Object.keys(fixtures) as EventName[])("accepts and narrows %s", (eventName) => {
    const parsed = parseOpenAIResponseEvent(message(eventName));

    expect(parsed.type).toBe(eventName);
    expect(JSON.stringify(parsed)).not.toContain("output_tokens");
  });

  it("preserves only lifecycle fields consumed by the provider", () => {
    expect(parseOpenAIResponseEvent(message("response.created"))).toEqual({
      responseId,
      status: "in_progress",
      type: "response.created",
    });
    expect(parseOpenAIResponseEvent(message("response.completed"))).toEqual({
      itemId,
      responseId,
      status: "completed",
      text: outputTextPart.text,
      type: "response.completed",
    });
    expect(parseOpenAIResponseEvent(message("response.output_item.added"))).toEqual({
      itemId,
      type: "response.output_item.added",
    });
    expect(parseOpenAIResponseEvent(message("response.output_item.done"))).toEqual({
      itemId,
      text: outputTextPart.text,
      type: "response.output_item.done",
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
          },
        }),
      ),
    ).toEqual({
      itemId,
      responseId,
      status: "completed",
      text: outputTextPart.text,
      type: "response.completed",
    });
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
    ).toEqual({ itemId, text: outputTextPart.text, type: "response.output_item.done" });
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

  it.each(["response.created", "response.in_progress"] as const)(
    "rejects contradictory fields on %s",
    (eventName) => {
      const source = fixtures[eventName];
      for (const responsePatch of [
        { error: { code: "server_error", message: "failed" } },
        { incomplete_details: { reason: "max_output_tokens" } },
        { output: [completedMessage] },
      ]) {
        expect(() =>
          parseOpenAIResponseEvent(
            message(eventName, {
              ...source,
              response: { ...source.response, ...responsePatch },
            }),
          ),
        ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
      }
    },
  );

  it("rejects unsafe or contradictory completed response output", () => {
    const source = fixtures["response.completed"];
    const invalidResponses = [
      { ...source.response, error: { code: "server_error", message: "failed" } },
      { ...source.response, incomplete_details: { reason: "max_output_tokens" } },
      { ...source.response, status: "failed" },
      { ...source.response, output: [completedMessage, completedMessage] },
      {
        ...source.response,
        output: [{ ...completedMessage, content: [outputTextPart, outputTextPart] }],
      },
      { ...source.response, output: [{ ...completedMessage, role: "user" }] },
      { ...source.response, output: [{ ...completedMessage, status: "in_progress" }] },
      {
        ...source.response,
        output: [{ ...completedMessage, content: [{ refusal: "no", type: "refusal" }] }],
      },
      { ...source.response, output: [{ id: "reasoning", summary: [], type: "reasoning" }] },
      {
        ...source.response,
        output: [{ arguments: "{}", call_id: "call", name: "x", type: "function_call" }],
      },
      {
        ...source.response,
        output: [{ id: "tool", status: "completed", type: "web_search_call" }],
      },
    ];
    for (const response of invalidResponses) {
      expect(() =>
        parseOpenAIResponseEvent(message("response.completed", { ...source, response })),
      ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
    }
  });

  it("requires bounded failure and incomplete details without success output", () => {
    const failed = fixtures["response.failed"];
    for (const responsePatch of [
      { error: null },
      { error: { code: "x".repeat(129), message: "failed" } },
      { output: [completedMessage] },
    ]) {
      expect(() =>
        parseOpenAIResponseEvent(
          message("response.failed", {
            ...failed,
            response: { ...failed.response, ...responsePatch },
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
    }

    const incomplete = fixtures["response.incomplete"];
    for (const responsePatch of [
      { incomplete_details: null },
      { incomplete_details: { reason: "x".repeat(129) } },
      { output: [completedMessage] },
    ]) {
      expect(() =>
        parseOpenAIResponseEvent(
          message("response.incomplete", {
            ...incomplete,
            response: { ...incomplete.response, ...responsePatch },
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
    }
  });

  it("does not retain top-level error diagnostics", () => {
    expect(parseOpenAIResponseEvent(message("error"))).toEqual({ type: "error" });
    expect(JSON.stringify(parseOpenAIResponseEvent(message("error")))).not.toContain(
      "stream failed",
    );
  });
});

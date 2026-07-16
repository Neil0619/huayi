import { describe, expect, it } from "vitest";

import {
  assistantAddedFixture,
  compatibleAssistantItemId,
  compatibleLifecycleMessages,
  compatibleMessage,
  compatibleOutputText,
  compatibleReasoningItemId,
  compatibleResponseId,
  completedFixture,
  completedMessageFixture,
  createdFixture,
  firstDeltaFixture,
  partAddedFixture,
  rateLimitsFixture,
  reasoningAddedFixture,
  reasoningDoneFixture,
  textDoneFixture,
} from "./compatible-http-responses-events-test-fixtures.js";
import { parseCompatibleHttpResponseEvent } from "./compatible-http-responses-events.js";

const expectedLifecycle = [
  { sequence: null, type: "codex.rate_limits" },
  { responseId: compatibleResponseId, sequence: 0, type: "response.created" },
  { responseId: compatibleResponseId, sequence: 1, type: "response.in_progress" },
  {
    itemId: compatibleReasoningItemId,
    itemType: "reasoning",
    outputIndex: 0,
    sequence: 2,
    type: "response.output_item.added",
  },
  {
    itemId: compatibleReasoningItemId,
    itemType: "reasoning",
    outputIndex: 0,
    sequence: 3,
    text: null,
    type: "response.output_item.done",
  },
  {
    itemId: compatibleAssistantItemId,
    itemType: "message",
    outputIndex: 0,
    sequence: 4,
    type: "response.output_item.added",
  },
  {
    itemId: compatibleAssistantItemId,
    outputIndex: 0,
    sequence: 5,
    text: "",
    type: "response.content_part.added",
  },
  {
    delta: '{"translation":',
    itemId: compatibleAssistantItemId,
    outputIndex: 0,
    sequence: 6,
    type: "response.output_text.delta",
  },
  {
    delta: '"测试"}',
    itemId: compatibleAssistantItemId,
    outputIndex: 0,
    sequence: 7,
    type: "response.output_text.delta",
  },
  {
    itemId: compatibleAssistantItemId,
    outputIndex: 0,
    sequence: 8,
    text: compatibleOutputText,
    type: "response.output_text.done",
  },
  {
    itemId: compatibleAssistantItemId,
    responseId: compatibleResponseId,
    sequence: null,
    text: compatibleOutputText,
    type: "response.completed",
  },
] as const;

describe("parseCompatibleHttpResponseEvent", () => {
  it("parses the complete observed lifecycle into the bounded normalized union", () => {
    expect(compatibleLifecycleMessages.map(parseCompatibleHttpResponseEvent)).toEqual(
      expectedLifecycle,
    );
  });

  it("retains a compatible terminal sequence when the gateway provides one", () => {
    expect(
      parseCompatibleHttpResponseEvent(
        compatibleMessage("response.completed", { ...completedFixture, sequence_number: 9 }),
      ),
    ).toEqual({ ...expectedLifecycle.at(-1), sequence: 9 });
  });

  it.each(["not-json", "null", "[]", "42", '"[DONE]"'])(
    "rejects malformed or non-object JSON: %s",
    (data) => {
      expect(() =>
        parseCompatibleHttpResponseEvent({ data, event: "response.created" }),
      ).toThrowError("Invalid compatible Responses event.");
    },
  );

  it("rejects unknown events, DONE sentinels and event/data type mismatches", () => {
    for (const message of [
      compatibleMessage("unknown.event", createdFixture),
      { data: "[DONE]", event: "response.completed" },
      compatibleMessage("response.created", { ...createdFixture, type: "response.in_progress" }),
    ]) {
      expect(() => parseCompatibleHttpResponseEvent(message)).toThrowError(
        "Invalid compatible Responses event.",
      );
    }
  });

  it("rejects unknown top-level, response, item and content-part fields", () => {
    const invalidMessages = [
      compatibleMessage("codex.rate_limits", { ...rateLimitsFixture, unexpected: 1 }),
      compatibleMessage("response.created", {
        ...createdFixture,
        response: { ...createdFixture.response, unexpected: 1 },
      }),
      compatibleMessage("response.output_item.added", {
        ...assistantAddedFixture,
        item: { ...assistantAddedFixture.item, unexpected: true },
      }),
      compatibleMessage("response.content_part.added", {
        ...partAddedFixture,
        part: { ...partAddedFixture.part, unexpected: true },
      }),
    ];

    for (const message of invalidMessages) {
      expect(() => parseCompatibleHttpResponseEvent(message)).toThrowError(
        "Invalid compatible Responses event.",
      );
    }
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects negative, fractional or unsafe sequence number %s",
    (sequenceNumber) => {
      expect(() =>
        parseCompatibleHttpResponseEvent(
          compatibleMessage("response.created", {
            ...createdFixture,
            sequence_number: sequenceNumber,
          }),
        ),
      ).toThrowError("Invalid compatible Responses event.");
    },
  );

  it("allows missing sequence only on captured opening metadata and terminal variants", () => {
    expect(() =>
      parseCompatibleHttpResponseEvent(
        compatibleMessage("codex.rate_limits", { ...rateLimitsFixture, sequence_number: 0 }),
      ),
    ).toThrowError("Invalid compatible Responses event.");
    expect(() =>
      parseCompatibleHttpResponseEvent(
        compatibleMessage("response.created", {
          response: createdFixture.response,
          type: createdFixture.type,
        }),
      ),
    ).toThrowError("Invalid compatible Responses event.");
  });

  it("rejects identifiers above 512 characters at every normalized identifier boundary", () => {
    const oversizedId = "x".repeat(513);
    const invalidMessages = [
      compatibleMessage("response.created", {
        ...createdFixture,
        response: { ...createdFixture.response, id: oversizedId },
      }),
      compatibleMessage("response.output_item.added", {
        ...assistantAddedFixture,
        item: { ...assistantAddedFixture.item, id: oversizedId },
      }),
      compatibleMessage("response.output_text.delta", {
        ...firstDeltaFixture,
        item_id: oversizedId,
      }),
      compatibleMessage("response.completed", {
        ...completedFixture,
        response: { ...completedFixture.response, id: oversizedId },
      }),
    ];

    for (const message of invalidMessages) {
      expect(() => parseCompatibleHttpResponseEvent(message)).toThrowError(
        "Invalid compatible Responses event.",
      );
    }
  });

  it.each(["function_call", "web_search_call", "computer_call", "refusal"])(
    "rejects unsafe output item type %s",
    (type) => {
      expect(() =>
        parseCompatibleHttpResponseEvent(
          compatibleMessage("response.output_item.added", {
            ...assistantAddedFixture,
            item: { ...assistantAddedFixture.item, type },
          }),
        ),
      ).toThrowError("Invalid compatible Responses event.");
    },
  );

  it("accepts only empty reasoning summaries and never exposes reasoning content", () => {
    expect(
      JSON.stringify(
        parseCompatibleHttpResponseEvent(
          compatibleMessage("response.output_item.done", reasoningDoneFixture),
        ),
      ),
    ).not.toContain("summary");

    for (const itemPatch of [
      { summary: [{ text: "hidden", type: "summary_text" }] },
      { content: [{ text: "hidden", type: "reasoning_text" }] },
      { encrypted_content: 42 },
      { content: [{ text: "hidden", type: "reasoning_text" }] },
    ]) {
      expect(() =>
        parseCompatibleHttpResponseEvent(
          compatibleMessage("response.output_item.added", {
            ...reasoningAddedFixture,
            item: { ...reasoningAddedFixture.item, ...itemPatch },
          }),
        ),
      ).toThrowError("Invalid compatible Responses event.");
    }
  });

  it("rejects refusal content and non-output-text content parts", () => {
    for (const part of [
      { refusal: "not rendered", type: "refusal" },
      { text: "hidden", type: "reasoning_text" },
    ]) {
      expect(() =>
        parseCompatibleHttpResponseEvent(
          compatibleMessage("response.content_part.added", { ...partAddedFixture, part }),
        ),
      ).toThrowError("Invalid compatible Responses event.");
    }
  });

  it("rejects completed responses with anything other than one assistant text item", () => {
    const invalidOutput = [
      [],
      [completedMessageFixture, completedMessageFixture],
      [{ ...completedMessageFixture, role: "user" }],
      [{ ...completedMessageFixture, content: [] }],
      [{ ...completedMessageFixture, content: [{ refusal: "no", type: "refusal" }] }],
      [{ ...completedMessageFixture, type: "function_call" }],
    ];

    for (const output of invalidOutput) {
      expect(() =>
        parseCompatibleHttpResponseEvent(
          compatibleMessage("response.completed", {
            ...completedFixture,
            response: { ...completedFixture.response, output },
          }),
        ),
      ).toThrowError("Invalid compatible Responses event.");
    }
  });

  it("rejects out-of-range indexes, empty deltas, wrong statuses and null sequences", () => {
    const invalidMessages = [
      compatibleMessage("response.output_item.added", {
        ...assistantAddedFixture,
        output_index: 2,
      }),
      compatibleMessage("response.content_part.added", { ...partAddedFixture, content_index: 1 }),
      compatibleMessage("response.output_text.delta", { ...firstDeltaFixture, delta: "" }),
      compatibleMessage("response.output_text.done", { ...textDoneFixture, sequence_number: null }),
      compatibleMessage("response.completed", {
        ...completedFixture,
        response: { ...completedFixture.response, status: "in_progress" },
      }),
    ];

    for (const message of invalidMessages) {
      expect(() => parseCompatibleHttpResponseEvent(message)).toThrowError(
        "Invalid compatible Responses event.",
      );
    }
  });
});

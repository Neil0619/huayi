import { describe, expect, it } from "vitest";

import {
  compatibleAssistantItemId,
  compatibleMessage,
  compatibleOutputText,
  compatibleReasoningItemId,
  compatibleResponseId,
} from "./compatible-http-responses-events-test-fixtures.js";
import {
  gatewayLifecycleMessages,
  gatewayNoIdCompletedMessage,
  gatewayReasoningAddedFixture,
} from "./compatible-http-responses-gateway-fixtures.js";
import { parseCompatibleHttpResponseEvent } from "./compatible-http-responses-events.js";

describe("measured compatible Responses gateway dialect", () => {
  it("normalizes the complete envelope and discards private transport metadata", () => {
    const events = gatewayLifecycleMessages.map(parseCompatibleHttpResponseEvent);

    expect(events).toEqual([
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
        outputIndex: 1,
        sequence: 4,
        type: "response.output_item.added",
      },
      {
        itemId: compatibleAssistantItemId,
        outputIndex: 1,
        sequence: 5,
        text: "",
        type: "response.content_part.added",
      },
      {
        delta: '{"translation":',
        itemId: compatibleAssistantItemId,
        outputIndex: 1,
        sequence: 6,
        type: "response.output_text.delta",
      },
      {
        delta: '"测试"}',
        itemId: compatibleAssistantItemId,
        outputIndex: 1,
        sequence: 7,
        type: "response.output_text.delta",
      },
      {
        itemId: compatibleAssistantItemId,
        outputIndex: 1,
        sequence: 8,
        text: compatibleOutputText,
        type: "response.output_text.done",
      },
      {
        itemId: compatibleAssistantItemId,
        outputIndex: 1,
        sequence: 9,
        text: compatibleOutputText,
        type: "response.content_part.done",
      },
      {
        itemId: compatibleAssistantItemId,
        itemType: "message",
        outputIndex: 1,
        sequence: 10,
        text: compatibleOutputText,
        type: "response.output_item.done",
      },
      {
        itemId: compatibleAssistantItemId,
        responseId: compatibleResponseId,
        sequence: 11,
        text: compatibleOutputText,
        type: "response.completed",
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /encrypted_content|instructions|logprobs|metadata|obfuscation|phase|turn_id|usage/u,
    );
  });

  it("retains the measured no-id completed-envelope variant", () => {
    expect(parseCompatibleHttpResponseEvent(gatewayNoIdCompletedMessage)).toMatchObject({
      itemId: null,
      responseId: compatibleResponseId,
      text: compatibleOutputText,
      type: "response.completed",
    });
  });

  it("rejects nonempty or structurally invalid protected reasoning fields", () => {
    for (const itemPatch of [
      { content: [{ text: "hidden", type: "reasoning_text" }] },
      { encrypted_content: null },
      { summary: [{ text: "hidden", type: "summary_text" }] },
    ]) {
      expect(() =>
        parseCompatibleHttpResponseEvent(
          compatibleMessage("response.output_item.added", {
            ...gatewayReasoningAddedFixture,
            item: { ...gatewayReasoningAddedFixture.item, ...itemPatch },
          }),
        ),
      ).toThrowError("Invalid compatible Responses event.");
    }
  });
});

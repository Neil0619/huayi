import { describe, expect, it } from "vitest";

import { parseOpenAiEvent } from "./provider-events.js";

describe("parseOpenAiEvent", () => {
  it("rejects unknown fields on nested OpenAI response objects", () => {
    expect(() =>
      parseOpenAiEvent({
        data: JSON.stringify({
          response: {
            error: null,
            id: "response-1",
            incomplete_details: null,
            output: [],
            status: "in_progress",
            unknown_nested_field: "must not be stripped",
          },
          sequence_number: 0,
          type: "response.created",
        }),
        event: "response.created",
      }),
    ).toThrow(/invalid response/i);
  });
});

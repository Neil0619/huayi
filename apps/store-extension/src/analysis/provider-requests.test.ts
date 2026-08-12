import type { AnalysisRequest } from "@huayi/store-domain";
import { describe, expect, it } from "vitest";

import { jsonSchemaFor } from "./model-contracts.js";
import { buildDeepSeekRequestBody } from "./provider-requests.js";

const request: AnalysisRequest = {
  action: "explain",
  context: "At least 23 people are missing.",
  providerId: "deepseek",
  requestId: "request-1",
  selection: "missing",
  selectionKind: "word",
  sentenceContext: "At least 23 people are missing.",
  targetLanguage: "zh-CN",
};

describe("DeepSeek ClassicParity request", () => {
  it("advertises the same English constraints that the final model parser enforces", () => {
    const schema = jsonSchemaFor("explain-word") as {
      properties: {
        wordForm: { properties: { baseForm: { pattern?: string } } };
      };
    };

    expect(schema.properties.wordForm.properties.baseForm.pattern).toBe(
      "^[^\\u3400-\\u9fff]*[A-Za-z][^\\u3400-\\u9fff]*$",
    );
  });

  it("keeps the Classic contextual word instructions instead of the abbreviated rewrite", () => {
    const body = JSON.parse(buildDeepSeekRequestBody(request, "explain-word")) as {
      messages: { content: string }[];
    };

    expect(body.messages[0]?.content).toContain(
      "When sentenceContext is non-null, it is the exact concrete sentence or caption",
    );
    expect(body.messages[0]?.content).toContain(
      "When sentenceContext is non-null, never claim that no specific sentence or context was provided.",
    );
  });
});

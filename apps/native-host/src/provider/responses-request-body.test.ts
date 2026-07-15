import { describe, expect, it } from "vitest";

import type { AnalyzeRequest } from "@huayi/protocol";

import { buildAnalysisPrompt } from "./prompt-builder.js";
import { buildResponsesRequestBody, type ResponsesRequest } from "./responses-request-body.js";

const outputSchema = { additionalProperties: false, properties: {}, type: "object" };

function analysisRequest(): AnalyzeRequest {
  return {
    action: "translate",
    context: "The investigation was in its early stages.",
    requestId: "analysis-1",
    schemaVersion: 4,
    selection: "investigation",
    selectionKind: "word",
    sentenceContext: "The investigation was in its early stages.",
    targetLanguage: "zh-CN",
    type: "analyze",
  };
}

describe("buildResponsesRequestBody", () => {
  it("builds the exact bounded Responses request shared by both HTTP providers", () => {
    const request: ResponsesRequest = {
      analysisRequest: analysisRequest(),
      modelConfiguration: { effort: "low", model: "gpt-5.4-mini" },
      outputSchema,
      outputSchemaName: "translate_lexical",
    };

    const body = JSON.parse(buildResponsesRequestBody(request)) as Record<string, unknown>;

    expect(body).toEqual({
      input: buildAnalysisPrompt(request.analysisRequest),
      model: "gpt-5.4-mini",
      reasoning: { effort: "low" },
      store: false,
      stream: true,
      text: {
        format: {
          name: "translate_lexical",
          schema: outputSchema,
          strict: true,
          type: "json_schema",
        },
      },
    });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("previous_response_id");
  });
});

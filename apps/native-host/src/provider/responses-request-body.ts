import type { AnalyzeRequest } from "@huayi/protocol";

import type { ModelOutputSchema } from "./model-schema-repository.js";
import { buildAnalysisPrompt } from "./prompt-builder.js";

export interface ResponsesModelConfiguration {
  readonly effort: "none" | "low";
  readonly model: "gpt-5.4-mini" | "gpt-5.6-luna";
}

export interface ResponsesRequest {
  readonly analysisRequest: AnalyzeRequest;
  readonly modelConfiguration: ResponsesModelConfiguration;
  readonly outputSchema: ModelOutputSchema;
  readonly outputSchemaName: string;
}

export function buildResponsesRequestBody(request: ResponsesRequest): string {
  return JSON.stringify({
    input: buildAnalysisPrompt(request.analysisRequest),
    model: request.modelConfiguration.model,
    reasoning: { effort: request.modelConfiguration.effort },
    store: false,
    stream: true,
    text: {
      format: {
        name: request.outputSchemaName,
        schema: request.outputSchema,
        strict: true,
        type: "json_schema",
      },
    },
  });
}

import {
  contractFixtures,
  storeAnalysisResultSchema,
  webDeepAnalysisSchema,
  candidateSchema,
} from "@huayi/cloud-contracts";
import { describe, expect, it } from "vitest";

import { buildDeepSeekAnalysisRequest } from "./deepseek-analysis-protocol.js";
import { deepSeekMaximumUsage } from "./deepseek-analysis-model.js";
import { createDeepSeekExtensionQueryModel } from "./deepseek-extension-query-model.js";

function outputExample(body: string) {
  const request = JSON.parse(body) as { messages: { content: string }[] };
  const system = request.messages[0]?.content ?? "";
  const example = /(?:^|\n)EXAMPLE_JSON_OUTPUT\n(.+)\nEND_EXAMPLE_JSON_OUTPUT(?:\n|$)/u.exec(
    system,
  )?.[1];
  expect(
    example,
    "Provider needs the nested JSON shape, not only top-level field names",
  ).toBeDefined();
  return JSON.parse(example ?? "null");
}

describe("platform model prompt contracts", () => {
  it.each([
    ["phrase", 4_096, 8_192],
    ["sentence", 8_192, 16_384],
    ["passage", 8_192, 16_384],
  ] as const)(
    "disables thinking for initial and repair requests within the %s two-call budget",
    (selectionKind, outputLimit, reservedOutputTokens) => {
      const input = { ...contractFixtures.startAnalysisRequest, selectionKind };
      const sentences = [{ analysisUnitId: "u1", ordinal: 0, sourceText: input.sourceText }];
      for (const repairContent of [undefined, '{"result":{}}']) {
        const request = JSON.parse(buildDeepSeekAnalysisRequest(input, sentences, repairContent));
        expect(request).toMatchObject({
          max_tokens: outputLimit,
          reasoning_effort: "low",
          response_format: { type: "json_object" },
          stream: true,
          stream_options: { include_usage: true },
          temperature: 0,
          thinking: { type: "disabled" },
        });
      }
      expect(deepSeekMaximumUsage(input)).toEqual({
        inputTokens: 65_536,
        outputTokens: reservedOutputTokens,
      });
    },
  );

  it.each(["phrase", "sentence", "passage"] as const)(
    "specifies a valid nested deep analysis for %s",
    (selectionKind) => {
      const input = { ...contractFixtures.startAnalysisRequest, selectionKind };
      const body = buildDeepSeekAnalysisRequest(input, [
        { analysisUnitId: "u1", ordinal: 0, sourceText: input.sourceText },
      ]);
      const example = outputExample(body);
      expect(webDeepAnalysisSchema.safeParse(example.result).success).toBe(true);
      expect(example.candidates.length).toBeGreaterThan(0);
      for (const candidate of example.candidates)
        expect(candidateSchema.safeParse(candidate).success).toBe(true);
      if (selectionKind !== "phrase")
        expect(
          example.candidates.some(
            (candidate: { type: string }) => candidate.type === "sentence-pattern",
          ),
        ).toBe(true);
    },
  );

  it.each([
    ["word", "translate"],
    ["word", "explain"],
    ["phrase", "translate"],
    ["phrase", "explain"],
    ["sentence", "translate"],
    ["sentence", "explain"],
    ["passage", "translate"],
    ["passage", "explain"],
  ] as const)(
    "gives %s %s the nested format accepted by the real result parser",
    async (selectionKind, action) => {
      let body: string | undefined;
      const model = createDeepSeekExtensionQueryModel({
        apiKey: "test-key",
        prices: {
          inputMicroUsdPerMillionTokens: 1,
          cachedInputMicroUsdPerMillionTokens: 1,
          outputMicroUsdPerMillionTokens: 1,
        },
        fetch: async (_url, init) => {
          body = init.body;
          return new Response(null, { status: 503 });
        },
      });
      await expect(
        model.run(
          { action, selectionKind, sourceText: "example", sourceType: "web-selection" },
          "request-1",
        ),
      ).rejects.toMatchObject({ code: "model_unavailable" });
      const example = outputExample(body ?? "{}");
      expect(
        storeAnalysisResultSchema.safeParse({
          ...example,
          requestId: "request-1",
          sourceText: "example",
        }).success,
      ).toBe(true);
      expect(example.selectionKind).toBe(selectionKind);
      expect(example.requestId).toBeUndefined();
      expect(example.sourceText).toBeUndefined();
    },
  );
});

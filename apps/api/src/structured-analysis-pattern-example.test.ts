import { structuredAnalysisContentSchema } from "@huayi/cloud-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStructuredAnalysisContent } from "./structured-analysis-output.js";
import { structuredAnalysisInstructions } from "./structured-analysis-prompt.js";
import { structuredAnalysisPatternExample as example } from "./structured-analysis-pattern-example.js";
import { buildDeepSeekAnalysisRequest } from "./deepseek-analysis-protocol.js";
import {
  structuredProviderInput as input,
  structuredProviderUnits as units,
  structuredProviderOutput,
} from "./test-support/structured-provider-fixture.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 };
afterEach(() => vi.restoreAllMocks());

describe("structured gapped-collocation guidance", () => {
  it("keeps phrase generation and repair on the expressions-only contract", () => {
    expect(structuredAnalysisInstructions("phrase")).not.toContain(JSON.stringify(example));
    const request = JSON.parse(
      buildDeepSeekAnalysisRequest(
        { ...input, selectionKind: "phrase", sourceText: "can" },
        [{ analysisUnitId: "u1", ordinal: 0, sourceText: "can" }],
        "invalid prior output",
      ),
    ) as { messages: { content: string }[] };
    expect(request.messages[2]?.content).toContain(
      "Never convert a phrase candidate to sentence_pattern.",
    );
    expect(request.messages[2]?.content).not.toContain(
      "represent the intended reusable construction as",
    );
  });
  it("includes a complete worked pattern which passes the actual strict product reader", () => {
    const instructions = structuredAnalysisInstructions("sentence");
    expect(instructions).toContain(JSON.stringify(example));
    const output = structuredProviderOutput();
    const row = output.result.sentences[0];
    if (!row) throw new Error("Missing fixture");
    const result = readStructuredAnalysisContent(
      JSON.stringify({
        previewZh: "说明阻碍关系。",
        result: {
          overall: output.result.overall,
          sentences: [
            {
              ...row,
              candidates: [example.candidate],
              sentenceStructure: {
                kind: "sentence",
                coreClauses: [
                  {
                    fragments: [{ text: example.sourceText, occurrence: 1 }],
                    explanationZh: "延误阻碍了行动。",
                  },
                ],
                modifiers: [],
              },
            },
          ],
        },
      }),
      { ...input, selectionKind: "sentence", sourceText: example.sourceText },
      [{ analysisUnitId: "u1", ordinal: 0, sourceText: example.sourceText }],
      usage,
      "first",
    );
    const content = structuredAnalysisContentSchema.parse(result.content);
    expect(content.result.recommendations[0]?.generatedExample).toEqual(
      example.candidate.learningAdvice.generatedExample,
    );
  });

  it("reports a malformed template and a gapped expression together for the one allowed repair", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const output = structuredProviderOutput();
    const pattern = output.result.sentences[0]?.candidates[0];
    const expression = output.result.sentences[1]?.candidates[0];
    if (!pattern || !("template" in pattern) || !expression || !("text" in expression))
      throw new Error("Missing fixture");
    pattern.template = "subject arrived.";
    expression.text = "can ...";
    const result = readStructuredAnalysisContent(
      JSON.stringify(output),
      input,
      units,
      usage,
      "first",
    );
    expect(result.feedback?.issues.map((issue) => issue.rule)).toEqual([
      "template-slot-reference",
      "slot-used-in-template",
      "recommendation-source-expression",
    ]);
    expect(result.feedback?.issues.map((issue) => issue.location)).toEqual([
      ["result", "sentences", 0, "candidates", 0],
      ["result", "sentences", 0, "candidates", 0],
      ["result", "sentences", 1, "candidates", 0, "learningAdvice", "sourceRefs"],
    ]);
  });
});

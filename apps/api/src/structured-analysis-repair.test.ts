import { diagnosticEventSchema, structuredAnalysisContentSchema } from "@huayi/cloud-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { simulatedProviderResponse } from "./acceptance-provider-response.js";
import {
  createDeepSeekAnalysisModel,
  type DeepSeekAnalysisFetch,
} from "./deepseek-analysis-model.js";
import { readStructuredAnalysisContent } from "./structured-analysis-output.js";
import { runDiagnosticScope, type DiagnosticWrite } from "./diagnostic-context.js";
import {
  structuredProviderInput as input,
  structuredProviderUnits as sentences,
  structuredProviderOutput,
} from "./test-support/structured-provider-fixture.js";

const usage = { inputTokens: 100, outputTokens: 200, cachedInputTokens: 20 };
const prices = {
  cachedInputMicroUsdPerMillionTokens: 500_000,
  inputMicroUsdPerMillionTokens: 1_000_000,
  outputMicroUsdPerMillionTokens: 2_000_000,
};
const cases = [
  {
    kind: "pattern",
    sentence: 0,
    example: "My parcel left.",
    rule: "recommendation-example-template",
  },
  {
    kind: "expression",
    sentence: 1,
    example: "I will swim.",
    rule: "recommendation-example-expression",
  },
] as const;

function invalidExample(index: number, example: string) {
  const output = structuredProviderOutput();
  const advice = output.result.sentences[index]?.candidates[0]?.learningAdvice;
  if (!advice) throw new Error("Missing recommendation fixture.");
  advice.generatedExample.sourceText = example;
  return output;
}

function valueAt(value: unknown, path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string | number, unknown>)[key];
  }, value);
}

function repairFeedback(body: string) {
  const request = JSON.parse(body) as { messages: { role: string; content: string }[] };
  const repair = request.messages.at(-1)?.content ?? "";
  const raw = repair.split("\nVALIDATION_FAILURES\n")[1]?.split("\nEND_VALIDATION_FAILURES\n")[0];
  if (!raw) throw new Error("Missing repair feedback.");
  return JSON.parse(raw) as {
    issues: { path: string[]; location?: (string | number)[]; rule?: string }[];
  };
}

afterEach(() => vi.restoreAllMocks());

describe("structured recommendation repair feedback", () => {
  it.each(cases)(
    "keeps stored $kind diagnostics compatible while logging only fixed rules",
    async (testCase) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const records: DiagnosticWrite[] = [];
      await runDiagnosticScope(
        {
          write: async (batch) => {
            records.push(...batch);
          },
        },
        async () => {
          readStructuredAnalysisContent(
            JSON.stringify(invalidExample(testCase.sentence, testCase.example)),
            input,
            sentences,
            usage,
            "first",
          );
        },
      );
      expect(records).toHaveLength(1);
      const event = diagnosticEventSchema.parse(records[0]?.event);
      expect(event.issues).toEqual([
        {
          code: "custom",
          path: ["result", "sentences", "*", "candidates", "*", "[redacted]"],
        },
      ]);
      expect(JSON.stringify(warn.mock.calls)).toContain(testCase.rule);
      for (const serialized of [JSON.stringify(records), JSON.stringify(warn.mock.calls)]) {
        expect(serialized).not.toContain(testCase.example);
        expect(serialized).not.toContain("location");
        expect(serialized).not.toContain(input.sourceText);
      }
    },
  );

  it.each(["phrase", "passage"] as const)(
    "keeps the original nonzero candidate position for a %s",
    (kind) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const output = structuredProviderOutput();
      const candidate = output.result.sentences[1]?.candidates[0];
      if (!candidate) throw new Error("Missing expression fixture.");
      const { learningAdvice, ...unadvised } = candidate;
      const candidates = [unadvised, candidate];
      const sourceText = "can";
      const command = kind === "phrase" ? { ...input, selectionKind: kind, sourceText } : input;
      const units =
        kind === "phrase" ? [{ analysisUnitId: "u1", ordinal: 0, sourceText }] : sentences;
      const privateOutput = {
        ...output,
        result:
          kind === "phrase"
            ? {
                contextualMeaningZh: "表示能力。",
                translationZh: "能够",
                structureAndCollocationZh: [],
                usageNotes: [],
                candidates,
              }
            : {
                ...output.result,
                sentences: output.result.sentences.map((row, index) =>
                  index === 1 ? { ...row, candidates } : row,
                ),
              },
      };
      expect(
        readStructuredAnalysisContent(JSON.stringify(privateOutput), command, units, usage, "first")
          .content,
      ).toBeDefined();
      learningAdvice.generatedExample.sourceText = "I will swim.";
      const read = readStructuredAnalysisContent(
        JSON.stringify(privateOutput),
        command,
        units,
        usage,
        "first",
      );
      const location = [
        ...(kind === "phrase" ? ["result"] : ["result", "sentences", 1]),
        "candidates",
        1,
        "learningAdvice",
        "generatedExample",
      ];
      expect(read.feedback?.issues[0]).toMatchObject({
        location,
        rule: "recommendation-example-expression",
      });
      expect(valueAt(privateOutput, location)).toMatchObject({ sourceText: "I will swim." });
    },
  );

  it.each(cases)("locates the invalid $kind example in the private provider JSON", (testCase) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const output = invalidExample(testCase.sentence, testCase.example);
    const read = readStructuredAnalysisContent(
      JSON.stringify(output),
      input,
      sentences,
      usage,
      "first",
    );
    expect(read.feedback?.stage).toBe("content-schema");
    expect(read.feedback?.issues).toContainEqual({
      code: "custom",
      path: ["result", "sentences", "*", "candidates", "*", "learningAdvice", "generatedExample"],
      location: [
        "result",
        "sentences",
        testCase.sentence,
        "candidates",
        0,
        "learningAdvice",
        "generatedExample",
      ],
      rule: testCase.rule,
    });
    const issue = read.feedback?.issues[0];
    expect(issue?.location).toBeDefined();
    expect(valueAt(output, issue?.location ?? [])).toMatchObject({ sourceText: testCase.example });
    expect(JSON.stringify(read.feedback)).not.toContain(testCase.example);
  });

  it.each(cases)(
    "sends actionable $kind feedback and accepts only a strictly valid repair",
    async (testCase) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const invalid = invalidExample(testCase.sentence, testCase.example);
      const fetch = vi
        .fn<DeepSeekAnalysisFetch>()
        .mockResolvedValueOnce(simulatedProviderResponse(invalid, false))
        .mockResolvedValueOnce(simulatedProviderResponse(structuredProviderOutput(), false));
      const generated = await createDeepSeekAnalysisModel({
        apiKey: "offline-key",
        fetch,
        prices,
      }).analyze({ input, sentences });
      const content = structuredAnalysisContentSchema.parse(generated.content);
      const detail = repairFeedback(fetch.mock.calls[1]?.[1].body ?? "");
      const issue = detail.issues.find((item) => item.rule === testCase.rule);
      expect(issue?.location).toBeDefined();
      expect(valueAt(invalid, issue?.location ?? [])).toMatchObject({
        sourceText: testCase.example,
      });
      expect(content.result.recommendations).toHaveLength(2);
      expect(JSON.stringify(content)).not.toContain(testCase.example);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(generated.billedCalls).toHaveLength(2);
      expect(generated.usageCostMicroUsd).toBe(256);
    },
  );

  it.each(cases)(
    "rejects a still-invalid $kind repair after exactly two billed calls",
    async (testCase) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const invalid = invalidExample(testCase.sentence, testCase.example);
      const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
        simulatedProviderResponse(invalid, false),
      );
      await expect(
        createDeepSeekAnalysisModel({ apiKey: "offline-key", fetch, prices }).analyze({
          input,
          sentences,
        }),
      ).rejects.toMatchObject({
        code: "model_output_invalid",
        usageCostMicroUsd: 256,
        billedCalls: [expect.any(Object), expect.any(Object)],
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
});

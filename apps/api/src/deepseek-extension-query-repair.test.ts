import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisUpdate, ExtensionQueryRequest } from "@huayi/cloud-contracts";

import {
  createDeepSeekExtensionQueryModel,
  type DeepSeekExtensionQueryFetch,
} from "./deepseek-extension-query-model.js";
import type { QueryOutputDiagnostic } from "./extension-query-output.js";

const generationId = "00000000-0000-4000-8000-000000000001";
const prices = {
  cachedInputMicroUsdPerMillionTokens: 1,
  inputMicroUsdPerMillionTokens: 2,
  outputMicroUsdPerMillionTokens: 3,
};
const input: ExtensionQueryRequest = {
  action: "translate",
  selectionKind: "word",
  sourceText: "people",
  sentenceContext: "Hundreds of people are trying to contain the fire.",
  sourceType: "web-selection",
};
// Synthetic output reproduces the observed partial-preview/invalid-final pattern.
// The original provider JSON was not retained, so this is not its recovered bad field.
const word = {
  type: "translate-word",
  selectionKind: "word",
  dictionaryForm: "people",
  contextualSense: { meaningZh: "人们", partOfSpeech: "noun" },
  commonMeanings: [{ meaningsZh: ["人", "人们", "人民"], partOfSpeech: "noun" }],
  commonPhrases: [
    { text: "people person", meaningZh: "善于交际的人" },
    { text: "of all people", meaningZh: "在所有人中偏偏" },
  ],
  confusableWords: [],
};

function stream(content: string): Response {
  const data = (choices: unknown[], usage?: unknown) =>
    `data: ${JSON.stringify({ id: "provider-1", model: "deepseek-v4-flash", choices, usage })}\n\n`;
  return new Response(
    data([{ index: 0, delta: { content }, finish_reason: null }]) +
      data([{ index: 0, delta: {}, finish_reason: "stop" }], {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      }) +
      "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function systemContract(body: { messages: { content: string }[] }) {
  const schema = body.messages[0]?.content.match(
    /OUTPUT_JSON_SCHEMA\n(.+)\nEND_OUTPUT_JSON_SCHEMA/u,
  );
  return schema?.[1] ? (JSON.parse(schema[1]) as Record<string, unknown>) : null;
}

afterEach(() => vi.restoreAllMocks());

describe("DeepSeek extension query structural repair", () => {
  it("repairs an invalid word result after readable previews using the failing field and its contract", async () => {
    const invalid = {
      ...word,
      confusableWords: [{ text: "person", meaningZh: "人", partOfSpeech: "noun" }],
    };
    const repaired = {
      ...invalid,
      confusableWords: [{ ...invalid.confusableWords[0], distinctionZh: "person 通常指单个人。" }],
    };
    const fetch = vi.fn<DeepSeekExtensionQueryFetch>(async (_url, init) => {
      const body = JSON.parse(init.body) as { messages: { content: string }[] };
      const repair = body.messages[2]?.content ?? "";
      const hasFeedback =
        repair.includes('"path":"confusableWords[0].distinctionZh"') &&
        repair.includes('"code":"invalid_type"');
      const contract = systemContract(body);
      return stream(JSON.stringify(hasFeedback && contract ? repaired : invalid));
    });
    const onDiagnostic = vi.fn();
    const updates: AnalysisUpdate[] = [];
    const model = createDeepSeekExtensionQueryModel({
      apiKey: "fixture",
      fetch,
      prices,
      onDiagnostic,
    });

    const result = await model.run(input, generationId, {
      onPreview: (update) => updates.push(update),
    });

    expect(updates.map((update) => "section" in update && update.section)).toEqual([
      "contextual-sense",
      "common-meanings",
      "common-phrases",
      "common-phrases",
    ]);
    expect(result.result).toMatchObject({
      ...repaired,
      requestId: generationId,
      sourceText: "people",
    });
    expect(result.billedCalls).toHaveLength(2);
    expect(result.usage).toEqual({ cachedInputTokens: 0, inputTokens: 20, outputTokens: 10 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId,
        attempt: "initial",
        stage: "schema",
        issues: [{ path: "confusableWords[0].distinctionZh", code: "invalid_type" }],
      }),
    );
  });

  it("records both rejected attempts without exposing model values, unknown keys or credentials", async () => {
    const secret = "PRIVATE_MODEL_VALUE_AND_KEY";
    const invalid = {
      ...word,
      pronunciation: { uk: null, [secret]: "https://private.example.test" },
      contextualSense: { meaningZh: "人们", partOfSpeech: secret },
      [secret]: "private@example.test",
    };
    const fetch = vi.fn<DeepSeekExtensionQueryFetch>(async () => stream(JSON.stringify(invalid)));
    const onDiagnostic = vi.fn();
    const model = createDeepSeekExtensionQueryModel({
      apiKey: "PRIVATE_API_KEY",
      fetch,
      prices,
      onDiagnostic,
    });

    await expect(model.run(input, generationId)).rejects.toMatchObject({
      code: "model_output_invalid",
      billedCalls: expect.arrayContaining([
        expect.objectContaining({
          usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
        }),
      ]),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onDiagnostic.mock.calls.map(([record]) => record.attempt)).toEqual([
      "initial",
      "repair",
    ]);
    expect(onDiagnostic.mock.calls[0]?.[0].issues).toEqual(
      expect.arrayContaining([
        { path: "contextualSense.partOfSpeech", code: "invalid_enum_value" },
        { path: "pronunciation.uk", code: "invalid_type" },
        { path: "pronunciation", code: "unrecognized_keys" },
        { path: "$", code: "unrecognized_keys" },
      ]),
    );
    const logged = JSON.stringify(onDiagnostic.mock.calls);
    for (const value of [
      secret,
      "PRIVATE_API_KEY",
      "people",
      "private@example.test",
      "https://",
      "人们",
    ])
      expect(logged).not.toContain(value);
  });

  it("reports malformed JSON safely and passes syntax feedback to the single repair", async () => {
    const fetch = vi.fn<DeepSeekExtensionQueryFetch>(async (_url, init) => {
      const body = JSON.parse(init.body) as { messages: { content: string }[] };
      return stream(
        body.messages[2]?.content.includes('"code":"invalid_json"')
          ? JSON.stringify(word)
          : '{"PRIVATE_JSON_SENTINEL":',
      );
    });
    const onDiagnostic = vi.fn();
    const model = createDeepSeekExtensionQueryModel({
      apiKey: "fixture",
      fetch,
      prices,
      onDiagnostic,
    });
    await expect(model.run(input, generationId)).resolves.toMatchObject({
      result: { type: "translate-word" },
    });
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "json",
        issues: [{ path: "$", code: "invalid_json" }],
      }),
    );
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain("PRIVATE_JSON_SENTINEL");
  });

  it("includes nested limits, enum values and optional pronunciation in the first request", async () => {
    const fetch = vi.fn<DeepSeekExtensionQueryFetch>(async (_url, init) => {
      const body = JSON.parse(init.body) as { messages: { content: string }[] };
      expect(systemContract(body)).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: expect.arrayContaining(["commonMeanings", "commonPhrases", "confusableWords"]),
        properties: {
          dictionaryForm: { type: "string", minLength: 1, maxLength: 120 },
          commonMeanings: {
            minItems: 1,
            maxItems: 4,
            items: { properties: { meaningsZh: { minItems: 1, maxItems: 3 } } },
          },
          commonPhrases: { maxItems: 4 },
          confusableWords: {
            maxItems: 4,
            items: {
              required: expect.arrayContaining(["distinctionZh"]),
              properties: {
                partOfSpeech: { enum: expect.arrayContaining(["noun", "verb", "phrase"]) },
              },
            },
          },
          pronunciation: { properties: { uk: { type: "string" }, us: { type: "string" } } },
        },
      });
      expect(systemContract(body)?.required).not.toContain("pronunciation");
      expect(body.messages[0]?.content).not.toContain("Required lists must contain at least one");
      expect(body.messages[0]?.content).toContain("Simplified Chinese");
      return stream(JSON.stringify(word));
    });
    const model = createDeepSeekExtensionQueryModel({ apiKey: "fixture", fetch, prices });
    await expect(model.run(input, generationId)).resolves.toMatchObject({
      result: { type: "translate-word" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("repairs a mismatched passage selection kind before accepting a final result", async () => {
    const fetch = vi.fn<DeepSeekExtensionQueryFetch>(async (_url, init) => {
      const body = JSON.parse(init.body) as { messages: { content: string }[] };
      const corrected = body.messages[2]?.content.includes('"path":"selectionKind"');
      return stream(
        JSON.stringify({
          type: "translate-passage",
          selectionKind: corrected ? "passage" : "sentence",
          translationZh: "这有效。试试看。",
        }),
      );
    });
    const onDiagnostic = vi.fn();
    const model = createDeepSeekExtensionQueryModel({
      apiKey: "fixture",
      fetch,
      prices,
      onDiagnostic,
    });
    await expect(
      model.run(
        {
          action: "translate",
          sourceType: "web-selection",
          selectionKind: "passage",
          sourceText: "This works. Try it.",
        },
        generationId,
      ),
    ).resolves.toMatchObject({ result: { selectionKind: "passage" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bounds diagnostic issues and keeps reporter failures from breaking a successful repair", async () => {
    const invalid = { ...word, confusableWords: Array.from({ length: 30 }, () => ({})) };
    const onDiagnostic = vi.fn<(record: QueryOutputDiagnostic) => void>(() => {
      throw new Error("diagnostic sink unavailable");
    });
    const fetch = vi
      .fn<DeepSeekExtensionQueryFetch>()
      .mockResolvedValueOnce(stream(JSON.stringify(invalid)))
      .mockResolvedValueOnce(stream(JSON.stringify(word)));
    const model = createDeepSeekExtensionQueryModel({
      apiKey: "fixture",
      fetch,
      prices,
      onDiagnostic,
    });
    await expect(model.run(input, generationId)).resolves.toMatchObject({
      result: { type: "translate-word" },
    });
    expect(onDiagnostic).toHaveBeenCalledOnce();
    expect(onDiagnostic.mock.calls[0]?.[0]).toMatchObject({ issuesTruncated: true });
    expect(onDiagnostic.mock.calls[0]?.[0].issues).toHaveLength(8);
  });

  it("writes a safe correlated diagnostic by default when both attempts fail", async () => {
    const write = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const model = createDeepSeekExtensionQueryModel({
      apiKey: "fixture",
      prices,
      fetch: async () => stream(JSON.stringify({ ...word, confusableWords: null })),
    });
    await expect(model.run(input, generationId)).rejects.toMatchObject({
      code: "model_output_invalid",
    });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: "extension-query-output-invalid",
        generationId,
        attempt: "repair",
        issues: [{ path: "confusableWords", code: "invalid_type" }],
      }),
    );
  });
});

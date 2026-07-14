import { Buffer } from "node:buffer";

import { MAX_STREAM_DELTA_LENGTH, MAX_WIRE_MESSAGE_BYTES } from "@huayi/protocol";
import { describe, expect, it, vi } from "vitest";

import type { AnalysisStreamUpdate } from "./analysis-provider.js";
import type { ModelResultType } from "./model-analysis-schemas.js";
import { ProviderValidationError } from "./provider-validation.js";
import { StreamingJsonFieldExtractor } from "./streaming-json-fields.js";
import { StreamingJsonTokenizer, type TopLevelJsonUpdate } from "./streaming-json-tokenizer.js";

function createExtractor(
  resultType: ModelResultType = "translate-lexical",
  sentenceContext: string | null = "The investigation continued.",
): StreamingJsonFieldExtractor {
  return new StreamingJsonFieldExtractor({ resultType, sentenceContext });
}

function captureValidationError(run: () => unknown): ProviderValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ProviderValidationError) return error;
    throw error;
  }
  throw new Error("Expected a ProviderValidationError.");
}

describe("StreamingJsonFieldExtractor", () => {
  it.each([
    [
      "translate-lexical",
      "collocations",
      "collocations",
      { meaningZh: "刑事调查", text: "criminal investigation" },
      { meaningZh: "深入调查", text: "thorough investigation" },
    ],
    [
      "translate-lexical",
      "similarTerms",
      "similar-terms",
      { meaningZh: "询问", partOfSpeech: "noun", text: "inquiry" },
      { meaningZh: "审查", partOfSpeech: "noun", text: "examination" },
    ],
    [
      "explain-lexical",
      "coreMeanings",
      "core-meanings",
      { meaningZh: "维持", partOfSpeech: "verb" },
      { meaningZh: "支撑", partOfSpeech: "verb" },
    ],
    [
      "explain-lexical",
      "synonyms",
      "synonyms",
      { meaningZh: "持久的", partOfSpeech: "adjective", text: "enduring" },
      { meaningZh: "连续的", partOfSpeech: "adjective", text: "continuous" },
    ],
  ] as const)(
    "emits cumulative %s %s sections item by item",
    (resultType, field, section, first, second) => {
      const extractor = createExtractor(resultType);

      expect(extractor.push(`{"${field}":[${JSON.stringify(first)},`)).toEqual([
        { section, type: "analysis-section", value: [first] },
      ]);
      expect(extractor.push(`${JSON.stringify(second)}]}`)).toEqual([
        { section, type: "analysis-section", value: [first, second] },
      ]);
      expect(() => extractor.finish()).not.toThrow();
    },
  );

  it("rejects an invalid array item before publishing it", () => {
    const first = createExtractor();
    expect(
      captureValidationError(() => first.push('{"collocations":[{"meaningZh":"调查","text":42},')),
    ).toMatchObject({ field: "collocations", stage: "model-schema" });

    const second = createExtractor();
    expect(
      second.push('{"collocations":[{"meaningZh":"调查","text":"investigation"},'),
    ).toHaveLength(1);
    expect(
      captureValidationError(() =>
        second.push('{"meaningZh":"审查","text":"examination","unsafe":true}]}'),
      ),
    ).toMatchObject({ field: "collocations", stage: "model-schema" });
  });

  it("fails closed on skipped or repeated item indexes", () => {
    for (const updates of [
      [
        {
          field: "collocations",
          index: 1,
          kind: "array-item",
          value: { meaningZh: "调查", text: "investigation" },
        },
      ],
      [
        {
          field: "collocations",
          index: 0,
          kind: "array-item",
          value: { meaningZh: "调查", text: "investigation" },
        },
        {
          field: "collocations",
          index: 0,
          kind: "array-item",
          value: { meaningZh: "审查", text: "examination" },
        },
      ],
    ] satisfies TopLevelJsonUpdate[][]) {
      const tokenizer = vi
        .spyOn(StreamingJsonTokenizer.prototype, "push")
        .mockReturnValueOnce(updates);
      try {
        expect(captureValidationError(() => createExtractor().push("x"))).toMatchObject({
          field: "collocations",
          stage: "stream-parse",
        });
      } finally {
        tokenizer.mockRestore();
      }
    }
  });

  it("rejects a fourth item and a final array inconsistent with streamed items", () => {
    const extractor = createExtractor();
    const items = ["one", "two", "three", "four"].map((text) => ({ meaningZh: "含义", text }));
    const prefixItems = items
      .slice(0, 3)
      .map((item) => JSON.stringify(item))
      .join(",");
    expect(extractor.push(`{"collocations":[${prefixItems},`)).toHaveLength(3);
    expect(
      captureValidationError(() => extractor.push(`${JSON.stringify(items[3])}]}`)),
    ).toMatchObject({ field: "collocations", stage: "model-schema" });

    const streamed = { meaningZh: "调查", text: "investigation" };
    const final = [{ meaningZh: "审查", text: "examination" }];
    const tokenizer = vi.spyOn(StreamingJsonTokenizer.prototype, "push").mockReturnValueOnce([
      { field: "collocations", index: 0, kind: "array-item", value: streamed },
      { field: "collocations", kind: "complete-value", value: final },
    ]);
    try {
      expect(captureValidationError(() => createExtractor().push("x"))).toMatchObject({
        field: "collocations",
        stage: "stream-parse",
      });
    } finally {
      tokenizer.mockRestore();
    }
  });

  it("keeps designated prose fields on the decoded text-delta path", () => {
    const lexical = createExtractor();

    expect(lexical.push('{"contextualMeaningZh":"调')).toEqual([
      { delta: "调", section: "contextual-meaning", type: "analysis-delta" },
    ]);
    expect(lexical.push('查\\n结\\u679c"}')).toEqual([
      { delta: "查\n结果", section: "contextual-meaning", type: "analysis-delta" },
    ]);
    expect(() => lexical.finish()).not.toThrow();

    const sentence = createExtractor("explain-sentence", null);
    expect(
      sentence.push(
        '{"mainStructure":"主干","translationZh":"翻译","contextRole":"语境作用",' +
          '"keyExpressions":[{"meaningZh":"结束","text":"ended"}]}',
      ),
    ).toEqual([
      { delta: "主干", section: "main-structure", type: "analysis-delta" },
      { delta: "翻译", section: "translation", type: "analysis-delta" },
      { delta: "语境作用", section: "context-role", type: "analysis-delta" },
    ]);
    expect(() => sentence.finish()).not.toThrow();
  });

  it("emits lexical translation sections only after each complete validated value", () => {
    const extractor = createExtractor();
    const updates: AnalysisStreamUpdate[] = [];

    updates.push(...extractor.push('{"partOfSpeech":"nou'));
    expect(updates).toEqual([]);
    updates.push(...extractor.push('n","pronunciation":{"uk":"/ɪn/","us":null'));
    expect(updates).toEqual([
      { section: "part-of-speech", type: "analysis-section", value: "noun" },
    ]);
    updates.push(...extractor.push('},"collocations":[{"meaningZh":"刑事调查",'));
    expect(updates).toEqual([
      { section: "part-of-speech", type: "analysis-section", value: "noun" },
      { section: "pronunciation", type: "analysis-section", value: { uk: "/ɪn/" } },
    ]);
    updates.push(...extractor.push('"text":"criminal investigation"}'));
    expect(updates).toHaveLength(2);
    updates.push(
      ...extractor.push(
        '],"contextExampleTranslationZh":"调查仍在继续。",' +
          '"similarTerms":[{"meaningZh":"询问","partOfSpeech":"noun","text":"inquiry"}]}',
      ),
    );

    expect(updates).toEqual([
      { section: "part-of-speech", type: "analysis-section", value: "noun" },
      { section: "pronunciation", type: "analysis-section", value: { uk: "/ɪn/" } },
      {
        section: "collocations",
        type: "analysis-section",
        value: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
      },
      {
        section: "context-example",
        type: "analysis-section",
        value: {
          english: "The investigation continued.",
          translationZh: "调查仍在继续。",
        },
      },
      {
        section: "similar-terms",
        type: "analysis-section",
        value: [{ meaningZh: "询问", partOfSpeech: "noun", text: "inquiry" }],
      },
    ]);
    expect(() => extractor.finish()).not.toThrow();
  });

  it("maps complete lexical explanation values to their public sections", () => {
    const extractor = createExtractor("explain-lexical");

    expect(
      extractor.push(
        '{"baseForm":"sustain","wordFormation":"sustain + -ed",' +
          '"coreMeanings":[{"meaningZh":"维持","partOfSpeech":"verb"}],' +
          '"collocations":[{"meaningZh":"持续努力","text":"sustained effort"}],' +
          '"synonyms":[{"meaningZh":"持久的","partOfSpeech":"adjective",' +
          '"text":"enduring"}]}',
      ),
    ).toEqual([
      { section: "base-form", type: "analysis-section", value: "sustain" },
      { section: "word-formation", type: "analysis-section", value: "sustain + -ed" },
      {
        section: "core-meanings",
        type: "analysis-section",
        value: [{ meaningZh: "维持", partOfSpeech: "verb" }],
      },
      {
        section: "collocations",
        type: "analysis-section",
        value: [{ meaningZh: "持续努力", text: "sustained effort" }],
      },
      {
        section: "synonyms",
        type: "analysis-section",
        value: [{ meaningZh: "持久的", partOfSpeech: "adjective", text: "enduring" }],
      },
    ]);
    expect(() => extractor.finish()).not.toThrow();
  });

  it("emits no section for nulls, empty arrays, or all-null pronunciation", () => {
    const translation = createExtractor();
    expect(
      translation.push(
        '{"pronunciation":null,"collocations":[],"contextExampleTranslationZh":null,' +
          '"similarTerms":[]}',
      ),
    ).toEqual([]);
    translation.finish();

    const allNullPronunciation = createExtractor();
    expect(allNullPronunciation.push('{"pronunciation":{"uk":null,"us":null}}')).toEqual([]);
    allNullPronunciation.finish();

    const explanation = createExtractor("explain-lexical");
    expect(
      explanation.push('{"baseForm":null,"wordFormation":null,"collocations":[],"synonyms":[]}'),
    ).toEqual([]);
    explanation.finish();
  });

  it("never accepts model-owned English for the context example", () => {
    const extractor = createExtractor(
      "translate-lexical",
      "Trusted sentence from the AnalyzeRequest.",
    );

    expect(extractor.push('{"contextExampleTranslationZh":"可信请求句子的翻译。"}')).toEqual([
      {
        section: "context-example",
        type: "analysis-section",
        value: {
          english: "Trusted sentence from the AnalyzeRequest.",
          translationZh: "可信请求句子的翻译。",
        },
      },
    ]);
  });

  it.each([
    ["partOfSpeech", '"secret"'],
    ["pronunciation", '{"uk":"/x/"}'],
    ["collocations", '[{"meaningZh":"调查","text":"investigation","unsafe":true}]'],
    ["contextExampleTranslationZh", "42"],
    ["similarTerms", '[{"meaningZh":"调查","partOfSpeech":"secret","text":"inquiry"}]'],
  ])("rejects a complete invalid private field %s as model-schema", (field, value) => {
    const extractor = createExtractor();

    const error = captureValidationError(() => extractor.push(`{"${field}":${value}}`));
    expect(error).toMatchObject({ field, stage: "model-schema" });
  });

  it("validates complete final-only fields even though it does not preview them", () => {
    const valid = createExtractor("explain-sentence", null);
    expect(valid.push('{"keyExpressions":[{"meaningZh":"结束","text":"ended"}]}')).toEqual([]);
    valid.finish();

    const invalid = createExtractor("explain-sentence", null);
    expect(captureValidationError(() => invalid.push('{"keyExpressions":[]}'))).toMatchObject({
      field: "keyExpressions",
      stage: "model-schema",
    });
  });

  it("ignores unknown fields for preview while accepting their JSON syntax", () => {
    const extractor = createExtractor();

    expect(
      extractor.push(
        '{"unknown":"ignored","nested":{"contextualMeaningZh":"nested"},' + '"other":["ignored"]}',
      ),
    ).toEqual([]);
    expect(() => extractor.finish()).not.toThrow();
  });

  it.each([
    '{"contextualMeaningZh":"first","contextualMeaningZh":"second"}',
    '{"unknown":1,"unknown":2}',
    '{"collocations":[1,2}',
  ])("classifies tokenizer failures as stream-parse: %s", (source) => {
    const extractor = createExtractor();

    expect(captureValidationError(() => extractor.push(source))).toMatchObject({
      stage: "stream-parse",
    });
  });

  it("classifies an unfinished container as stream-parse at finish", () => {
    const extractor = createExtractor();
    extractor.push('{"collocations":[');

    expect(captureValidationError(() => extractor.finish())).toMatchObject({
      stage: "stream-parse",
    });
  });

  it("splits long prose into protocol-safe deltas without splitting surrogate pairs", () => {
    const extractor = createExtractor();
    const value = `${"a".repeat(MAX_STREAM_DELTA_LENGTH - 1)}😀${"b".repeat(4_903)}`;

    const updates = extractor.push(`{"contextualMeaningZh":"${value}`);
    const deltas = updates.filter((update) => update.type === "analysis-delta");

    expect(deltas.map((update) => update.delta).join("")).toBe(value);
    expect(deltas.length).toBeGreaterThan(2);
    for (const update of deltas) {
      expect(update.delta.length).toBeGreaterThanOrEqual(1);
      expect(update.delta.length).toBeLessThanOrEqual(MAX_STREAM_DELTA_LENGTH);
      expect(update.delta).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(update.delta).not.toMatch(/^[\uDC00-\uDFFF]/u);
    }
    expect(captureValidationError(() => extractor.finish())).toMatchObject({
      stage: "stream-parse",
    });
  });

  it("enforces the one-MiB accumulated UTF-8 assistant JSON limit", () => {
    const prefix = '{"unknown":"';
    const suffix = '"}';
    const contentBudget =
      MAX_WIRE_MESSAGE_BYTES - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
    const multibyteCount = Math.floor(contentBudget / Buffer.byteLength("界"));
    const remainder = contentBudget - multibyteCount * Buffer.byteLength("界");
    const maximumInput = `${prefix}${"界".repeat(multibyteCount)}${"a".repeat(remainder)}${suffix}`;

    const atLimit = createExtractor();
    expect(Buffer.byteLength(maximumInput)).toBe(MAX_WIRE_MESSAGE_BYTES);
    expect(() => atLimit.push(maximumInput)).not.toThrow();
    expect(() => atLimit.finish()).not.toThrow();

    const overLimit = createExtractor();
    expect(captureValidationError(() => overLimit.push(`${maximumInput} `))).toMatchObject({
      stage: "stream-parse",
    });
  });
});

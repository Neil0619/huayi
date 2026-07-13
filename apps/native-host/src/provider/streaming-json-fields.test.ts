import { Buffer } from "node:buffer";

import { MAX_STREAM_DELTA_LENGTH, MAX_WIRE_MESSAGE_BYTES } from "@huayi/protocol";
import { describe, expect, it } from "vitest";

import type { AnalysisStreamUpdate } from "./analysis-provider.js";
import type { ModelResultType } from "./model-analysis-schemas.js";
import { ProviderValidationError } from "./provider-validation.js";
import { StreamingJsonFieldExtractor } from "./streaming-json-fields.js";

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

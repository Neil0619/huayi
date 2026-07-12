import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { StreamingJsonFieldExtractor } from "./streaming-json-fields.js";

const contextualField = new Map([["contextualMeaningZh", "contextual-meaning"]] as const);

describe("StreamingJsonFieldExtractor", () => {
  it("emits decoded text from a configured top-level field across source chunks", () => {
    const extractor = new StreamingJsonFieldExtractor(contextualField);

    expect(extractor.push('{"contextualMeaningZh":"调')).toEqual([
      { delta: "调", section: "contextual-meaning" },
    ]);
    expect(extractor.push('查\\n结\\u679c","other":"ignored"}')).toEqual([
      { delta: "查\n结果", section: "contextual-meaning" },
    ]);
    expect(() => extractor.finish()).not.toThrow();
  });

  it("decodes escaped quotes, backslashes, split Unicode escapes, and surrogate pairs", () => {
    const extractor = new StreamingJsonFieldExtractor(contextualField);

    expect(extractor.push('{"contextualMeaningZh":"引\\"号\\\\路径\\n\\u8c')).toEqual([
      { delta: '引"号\\路径\n', section: "contextual-meaning" },
    ]);
    expect(extractor.push("03\\uD83D")).toEqual([{ delta: "调", section: "contextual-meaning" }]);
    expect(extractor.push('\\uDE00"}')).toEqual([{ delta: "😀", section: "contextual-meaning" }]);
    expect(() => extractor.finish()).not.toThrow();
  });

  it("holds a literal surrogate pair split across source chunks", () => {
    const extractor = new StreamingJsonFieldExtractor(contextualField);
    const emoji = "😀";

    expect(extractor.push(`{"contextualMeaningZh":"${emoji[0]}`)).toEqual([]);
    expect(extractor.push(`${emoji[1]}"}`)).toEqual([
      { delta: emoji, section: "contextual-meaning" },
    ]);
    expect(() => extractor.finish()).not.toThrow();
  });

  it("ignores unknown and nested fields even when a nested key is configured", () => {
    const extractor = new StreamingJsonFieldExtractor(contextualField);

    expect(
      extractor.push(
        '{"unknown":"ignored","nested":{"contextualMeaningZh":"nested"},' +
          '"contextualMeaningZh":"kept","unknown":"also ignored"}',
      ),
    ).toEqual([{ delta: "kept", section: "contextual-meaning" }]);
    expect(() => extractor.finish()).not.toThrow();
  });

  it("emits multiple configured top-level fields with their own sections", () => {
    const extractor = new StreamingJsonFieldExtractor(
      new Map([
        ["mainStructure", "main-structure"],
        ["translationZh", "translation"],
        ["contextRole", "context-role"],
      ] as const),
    );

    expect(
      extractor.push('{"mainStructure":"主干","translationZh":"翻译","contextRole":"作用"}'),
    ).toEqual([
      { delta: "主干", section: "main-structure" },
      { delta: "翻译", section: "translation" },
      { delta: "作用", section: "context-role" },
    ]);
    expect(() => extractor.finish()).not.toThrow();
  });

  it("rejects duplicate configured top-level keys", () => {
    const extractor = new StreamingJsonFieldExtractor(contextualField);

    expect(() =>
      extractor.push('{"contextualMeaningZh":"first","contextualMeaningZh":"second"}'),
    ).toThrow(SyntaxError);
  });

  it.each(["null", "false", "42", "[]", "{}"])(
    "rejects a non-string configured field value: %s",
    (value) => {
      const extractor = new StreamingJsonFieldExtractor(contextualField);

      expect(() => extractor.push(`{"contextualMeaningZh":${value}}`)).toThrow(SyntaxError);
    },
  );

  it("accepts trailing whitespace and rejects a trailing JSON value", () => {
    const extractor = new StreamingJsonFieldExtractor(contextualField);

    extractor.push('{"contextualMeaningZh":"done"} \n\t');
    expect(() => extractor.finish()).not.toThrow();
    expect(() => extractor.push("{}")).toThrow(SyntaxError);
  });

  it.each([
    "",
    "{",
    '{"contextualMeaningZh"',
    '{"contextualMeaningZh":"unfinished',
    '{"contextualMeaningZh":"\\u67',
    '{"contextualMeaningZh":"value"',
  ])("rejects incomplete JSON at finish: %s", (input) => {
    const extractor = new StreamingJsonFieldExtractor(contextualField);

    extractor.push(input);
    expect(() => extractor.finish()).toThrow(SyntaxError);
  });

  it("splits long output into protocol-safe pieces without splitting surrogate pairs", () => {
    const extractor = new StreamingJsonFieldExtractor(contextualField);
    const value = `${"a".repeat(4_095)}😀${"b".repeat(4_903)}`;

    const chunks = extractor.push(JSON.stringify({ contextualMeaningZh: value }));

    expect(chunks.map((chunk) => chunk.delta).join("")).toBe(value);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.delta.length).toBeGreaterThanOrEqual(1);
      expect(chunk.delta.length).toBeLessThanOrEqual(4_096);
      expect(chunk.delta).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(chunk.delta).not.toMatch(/^[\uDC00-\uDFFF]/u);
    }
    expect(() => extractor.finish()).not.toThrow();
  });

  it("enforces a one-MiB accumulated UTF-8 input limit", () => {
    const maximumBytes = 1_024 * 1_024;
    const prefix = '{"ignored":"';
    const suffix = '"}';
    const contentBudget = maximumBytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
    const multibyteCount = Math.floor(contentBudget / Buffer.byteLength("界"));
    const remainder = contentBudget - multibyteCount * Buffer.byteLength("界");
    const maximumInput = `${prefix}${"界".repeat(multibyteCount)}${"a".repeat(remainder)}${suffix}`;

    const atLimit = new StreamingJsonFieldExtractor(contextualField);
    expect(Buffer.byteLength(maximumInput)).toBe(maximumBytes);
    expect(() => atLimit.push(maximumInput)).not.toThrow();
    expect(() => atLimit.finish()).not.toThrow();

    const overLimit = new StreamingJsonFieldExtractor(contextualField);
    expect(() => overLimit.push(`${maximumInput} `)).toThrow(RangeError);
  });
});

import { describe, expect, it } from "vitest";

import { StreamingJsonTokenizer, type TopLevelJsonUpdate } from "./streaming-json-tokenizer.js";

function tokenizeAtBoundary(source: string, boundary: number): TopLevelJsonUpdate[] {
  const tokenizer = new StreamingJsonTokenizer();
  const updates = [
    ...tokenizer.push(source.slice(0, boundary)),
    ...tokenizer.push(source.slice(boundary)),
  ];
  tokenizer.finish();
  return updates;
}

function completeValues(updates: TopLevelJsonUpdate[]): TopLevelJsonUpdate[] {
  return updates.filter((update) => update.kind === "complete-value");
}

function streamedString(updates: TopLevelJsonUpdate[], field: string): string {
  return updates
    .filter((update) => update.kind === "string-delta" && update.field === field)
    .map((update) => update.value)
    .join("");
}

describe("StreamingJsonTokenizer", () => {
  it("captures arrays and objects correctly at every source chunk boundary", () => {
    const source =
      '{"items":[{"text":"quoted } ] { [ value","nested":[1,true,null]}],' +
      '"metadata":{"escaped":"brace \\"}\\" and slash \\\\","empty":{}}}';
    const expected = [
      {
        field: "items",
        kind: "complete-value",
        value: [{ nested: [1, true, null], text: "quoted } ] { [ value" }],
      },
      {
        field: "metadata",
        kind: "complete-value",
        value: { empty: {}, escaped: 'brace "}" and slash \\' },
      },
    ];

    for (let boundary = 0; boundary <= source.length; boundary += 1) {
      expect(completeValues(tokenizeAtBoundary(source, boundary))).toEqual(expected);
    }
  });

  it("decodes strings, escapes, CR/LF, Unicode escapes, and surrogate pairs at every boundary", () => {
    const value = 'line one\r\nline "two" \\ 调😀';
    const source = JSON.stringify({ text: value });

    for (let boundary = 0; boundary <= source.length; boundary += 1) {
      const updates = tokenizeAtBoundary(source, boundary);
      expect(streamedString(updates, "text")).toBe(value);
      expect(completeValues(updates)).toEqual([{ field: "text", kind: "complete-value", value }]);
    }
  });

  it("holds a literal surrogate pair until both UTF-16 code units arrive", () => {
    const tokenizer = new StreamingJsonTokenizer();
    const emoji = "😀";

    expect(tokenizer.push(`{"text":"${emoji[0]}`)).toEqual([]);
    expect(tokenizer.push(`${emoji[1]}"}`)).toEqual([
      { field: "text", kind: "string-delta", value: emoji },
      { field: "text", kind: "complete-value", value: emoji },
    ]);
    expect(() => tokenizer.finish()).not.toThrow();
  });

  it("captures every JSON primitive at every source chunk boundary", () => {
    const source = '{"nil":null,"no":false,"yes":true,"integer":42,"number":-1.5e+2}';
    const expected = [
      { field: "nil", kind: "complete-value", value: null },
      { field: "no", kind: "complete-value", value: false },
      { field: "yes", kind: "complete-value", value: true },
      { field: "integer", kind: "complete-value", value: 42 },
      { field: "number", kind: "complete-value", value: -150 },
    ];

    for (let boundary = 0; boundary <= source.length; boundary += 1) {
      expect(completeValues(tokenizeAtBoundary(source, boundary))).toEqual(expected);
    }
  });

  it("allows JSON whitespace split across CR/LF chunk boundaries", () => {
    const source = ' \r\n { \r\n "value" \r\n : \r\n [1, 2] \r\n } \r\n ';

    for (let boundary = 0; boundary <= source.length; boundary += 1) {
      expect(completeValues(tokenizeAtBoundary(source, boundary))).toEqual([
        { field: "value", kind: "complete-value", value: [1, 2] },
      ]);
    }
  });

  it.each(['{"field":1,"field":2}', '{"unknown":1,"unknown":2}', '{"field":1,"\\u0066ield":2}'])(
    "rejects duplicate decoded root keys: %s",
    (source) => {
      const tokenizer = new StreamingJsonTokenizer();

      expect(() => tokenizer.push(source)).toThrow(/duplicate/i);
    },
  );

  it.each([
    ['{"value":[1,2}', /mismatch|container/i],
    ['{"value":{"nested":true]]}', /mismatch|container/i],
    ['{"value":truE}', /invalid json value/i],
    ['{"value":[1,,2]}', /invalid json value/i],
    ['{"value":"\\x"}', /escape/i],
    ['{"value":"line\nbreak"}', /control/i],
    ['{"value":1,}', /object key/i],
    ['{"value" 1}', /colon/i],
    ['{"value":1}[]', /trailing/i],
    ["[]", /root.*object|json object/i],
  ])("rejects syntax and container boundary errors in %s", (source, expected) => {
    const tokenizer = new StreamingJsonTokenizer();

    expect(() => tokenizer.push(source)).toThrow(expected);
  });

  it.each([
    "",
    "{",
    '{"value"',
    '{"value":',
    '{"value":"unfinished',
    '{"value":"\\u67',
    '{"value":[1,2',
    '{"value":{"nested":true}',
    '{"value":tru',
  ])("rejects unfinished input at finish: %s", (source) => {
    const tokenizer = new StreamingJsonTokenizer();
    tokenizer.push(source);

    expect(() => tokenizer.finish()).toThrow(/incomplete/i);
  });

  it("allows trailing whitespace but rejects input after finish", () => {
    const tokenizer = new StreamingJsonTokenizer();
    tokenizer.push('{"value":1} \r\n');
    tokenizer.finish();

    expect(() => tokenizer.push(" ")).toThrow(/already complete/i);
  });
});

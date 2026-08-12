import { describe, expect, it } from "vitest";

import { parseProviderJson } from "./provider-json.js";

describe("parseProviderJson", () => {
  it.each([
    '{"value":1,"value":2}',
    '{"outer":{"value":1,"value":2}}',
    '{"escaped":1,"\\u0065scaped":2}',
    '{"😀":1,"\\ud83d\\ude00":2}',
  ])("rejects duplicate decoded object keys: %s", (source) => {
    expect(() => parseProviderJson(source)).toThrow(/invalid response/i);
  });

  it("allows the same key in separate array objects", () => {
    expect(parseProviderJson('{"items":[{"value":1},{"value":2}]}')).toEqual({
      items: [{ value: 1 }, { value: 2 }],
    });
  });

  it.each([
    "",
    "{",
    '{"value":truE}',
    '{"value":[1,,2]}',
    '{"value":"\\x"}',
    '{"value":01}',
    '{"value":1e}',
    '{"value":1} trailing',
  ])("rejects malformed JSON: %s", (source) => {
    expect(() => parseProviderJson(source)).toThrow(/invalid response/i);
  });

  it("accepts escaped strings, arrays, primitives, and Unicode escapes", () => {
    expect(
      parseProviderJson(
        '{"text":"line\\n\\"two\\" \\u8c03\\ud83d\\ude00","values":[null,true,false,-12.5e+2]}',
      ),
    ).toEqual({ text: 'line\n"two" 调😀', values: [null, true, false, -1250] });
  });
});

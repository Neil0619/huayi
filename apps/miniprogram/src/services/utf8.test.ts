import { expect, it } from "vitest";
import { createUtf8Decoder } from "./utf8";
it("decodes Chinese and supplementary characters split at every byte boundary", () => {
  const text = "原句 🙂 café\n";
  const bytes = new TextEncoder().encode(text);
  for (let split = 0; split <= bytes.length; split++) {
    const decoder = createUtf8Decoder();
    expect(
      decoder.push(bytes.slice(0, split)) + decoder.push(bytes.slice(split)) + decoder.finish(),
    ).toBe(text);
  }
});
it("rejects malformed, overlong, surrogate and incomplete UTF-8", () => {
  for (const bytes of [
    [0xff],
    [0xc0, 0xaf],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xe4, 0x41, 0xad],
  ])
    expect(() => createUtf8Decoder().push(Uint8Array.from(bytes))).toThrow();
  const decoder = createUtf8Decoder();
  decoder.push(Uint8Array.from([0xe4, 0xb8]));
  expect(() => decoder.finish()).toThrow();
});

import { describe, expect, it } from "vitest";
import { resolveSourceFragments, validateSourceSpans } from "./source-fragments.js";

describe("trusted source fragments", () => {
  it("assembles a discontinuous main clause from exact ordered source fragments", () => {
    expect(
      resolveSourceFragments("The book that I bought arrived.", [
        { text: "The book", occurrence: 1 },
        { text: "arrived", occurrence: 1 },
      ]),
    ).toEqual([
      { text: "The book", start: 0, end: 8 },
      { text: "arrived", start: 23, end: 30 },
    ]);
  });

  it("resolves the selected repetition and counts offsets in original UTF-16 code units", () => {
    expect(
      resolveSourceFragments("😀we can we can", [
        { text: "we", occurrence: 1 },
        { text: "can", occurrence: 1 },
        { text: "we", occurrence: 2 },
        { text: "can", occurrence: 2 },
      ]),
    ).toEqual([
      { text: "we", start: 2, end: 4 },
      { text: "can", start: 5, end: 8 },
      { text: "we", start: 9, end: 11 },
      { text: "can", start: 12, end: 15 },
    ]);
  });

  it("keeps literal quotes and whitespace instead of normalizing the evidence", () => {
    const source = "‘We  can’";
    const spans = [{ text: "‘We  can’", start: 0, end: 9 }];
    expect(resolveSourceFragments(source, [{ text: source, occurrence: 1 }])).toEqual(spans);
    expect(validateSourceSpans(source, spans)).toEqual(spans);
    for (const text of ["'We  can'", "‘We can’", "‘we  can’"])
      expect(() => resolveSourceFragments(source, [{ text, occurrence: 1 }])).toThrow();
  });

  it("counts overlapping exact matches when selecting an occurrence", () => {
    expect(resolveSourceFragments("banana", [{ text: "ana", occurrence: 2 }])).toEqual([
      { text: "ana", start: 3, end: 6 },
    ]);
  });

  it("allows adjacent fragments and preserves CRLF offsets", () => {
    expect(
      resolveSourceFragments("We\r\ncan!", [
        { text: "We\r\n", occurrence: 1 },
        { text: "can", occurrence: 1 },
        { text: "!", occurrence: 1 },
      ]),
    ).toEqual([
      { text: "We\r\n", start: 0, end: 4 },
      { text: "can", start: 4, end: 7 },
      { text: "!", start: 7, end: 8 },
    ]);
  });

  it.each(
    [
      [{ text: "We might", occurrence: 1 }],
      [{ text: "We", occurrence: 2 }],
      [{ text: "", occurrence: 1 }],
      [{ text: " ", occurrence: 1 }],
      [{ text: "We", occurrence: 0 }],
      [{ text: "We", occurrence: 1.5 }],
      [{ text: "We", occurrence: 1, start: 0 }],
      [{ text: "We", occurrence: 1, owner: "model-owned" }],
      [],
      Array.from({ length: 13 }, () => ({ text: "We", occurrence: 1 })),
    ].map((references) => ({ references })),
  )("rejects invalid model references: %j", ({ references }) => {
    expect(() => resolveSourceFragments("We can.", references)).toThrow();
  });

  it("rejects reverse order, duplicate positions and partially overlapping fragments", () => {
    for (const references of [
      [
        { text: "we", occurrence: 2 },
        { text: "we", occurrence: 1 },
      ],
      [
        { text: "we", occurrence: 1 },
        { text: "we", occurrence: 1 },
      ],
      [
        { text: "we can", occurrence: 1 },
        { text: "can", occurrence: 1 },
      ],
    ])
      expect(() => resolveSourceFragments("we can we can", references)).toThrow();
  });

  it("validates stored spans against the original again, including order and shape", () => {
    const source = "We can.";
    for (const spans of [
      [{ text: "We", start: 1, end: 3 }],
      [{ text: "We", start: 0, end: 3 }],
      [{ text: "We", start: -1, end: 1 }],
      [
        { text: "can", start: 3, end: 6 },
        { text: "We", start: 0, end: 2 },
      ],
      [{ text: "We", start: 0, end: 2, occurrence: 1 }],
    ])
      expect(() => validateSourceSpans(source, spans)).toThrow();
    expect(validateSourceSpans(source, [{ text: "can", start: 3, end: 6 }])).toEqual([
      { text: "can", start: 3, end: 6 },
    ]);
  });

  it("rejects references and offsets that split a Unicode surrogate pair", () => {
    expect(() => resolveSourceFragments("😀we", [{ text: "\ud83d", occurrence: 1 }])).toThrow();
    expect(() => validateSourceSpans("😀we", [{ text: "\ude00", start: 1, end: 2 }])).toThrow();
  });

  it("bounds the trusted source and preserves the caller's inputs", () => {
    for (const source of ["", " ", "x".repeat(2001)])
      expect(() => resolveSourceFragments(source, [{ text: "x", occurrence: 1 }])).toThrow();
    const references = Object.freeze([Object.freeze({ text: "We", occurrence: 1 })]);
    const spans = resolveSourceFragments("We can.", references);
    const first = spans[0];
    if (!first) throw new Error("Expected mapped fragment");
    first.text = "changed";
    expect(references).toEqual([{ text: "We", occurrence: 1 }]);
  });
});

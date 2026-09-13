import { describe, expect, it } from "vitest";
import { z } from "zod/v3";
import { segmentSentenceSource, validateSentenceSourceUnits } from "./sentence-source-units.js";

const unit = (sourceText: string, ordinal = 0) => ({
  sourceText,
  ordinal,
  analysisUnitId: `u${ordinal + 1}`,
});
describe("trusted sentence source units", () => {
  it.each([
    ["She said, “Go now.” Then she left.", ["She said, “Go now.”", "Then she left."]],
    [
      "He shouted, 'Stop!' before leaving. She stayed.",
      ["He shouted, 'Stop!' before leaving.", "She stayed."],
    ],
    [
      "Dr. Smith works in the U.S. office. Meet Mr. Jones.",
      ["Dr. Smith works in the U.S. office.", "Meet Mr. Jones."],
    ],
    [
      "Try e.g. this option. It costs 3.14 dollars.",
      ["Try e.g. this option.", "It costs 3.14 dollars."],
    ],
    ["Wait... Really?! Yes!", ["Wait...", "Really?!", "Yes!"]],
    ["An unfinished fragment", ["An unfinished fragment"]],
    ["(She left.) They stayed.", ["(She left.)", "They stayed."]],
  ])("preserves complete literal text when splitting %s", (source, expected) => {
    const result = segmentSentenceSource(source);
    expect(result.map((item) => item.sourceText)).toEqual(expected);
    expect(validateSentenceSourceUnits(source, result)).toEqual(result);
  });

  it("skips only separating whitespace and retains internal CRLF, double spaces and emoji", () => {
    const source = "  😀We\r\ncan  do it.\r\n‘They stayed.’  ";
    expect(segmentSentenceSource(source)).toEqual([
      unit("😀We\r\ncan  do it."),
      unit("‘They stayed.’", 1),
    ]);
  });

  it("rejects omitted, changed, reordered or misidentified units on readback", () => {
    const source = "We can. They can.";
    for (const units of [
      [unit("We can.")],
      [unit("They can."), unit("We can.", 1)],
      [unit("We CAN."), unit("They can.", 1)],
      [unit("We can."), { ...unit("They can.", 1), analysisUnitId: "u3" }],
      [unit("We can."), { ...unit("They can.", 1), ordinal: 0 }],
      [unit("We can."), { ...unit("They can.", 1), model: "spoofed" }],
      [],
    ])
      expect(() => validateSentenceSourceUnits(source, units)).toThrow(z.ZodError);
  });

  it("enforces the 40-unit bound without silently dropping the remaining source", () => {
    const forty = "Go. ".repeat(40);
    expect(segmentSentenceSource(forty)).toHaveLength(40);
    expect(() => segmentSentenceSource(`${forty}Go.`)).toThrow(z.ZodError);
    for (const source of ["", " \r\n", "x".repeat(2001)])
      expect(() => segmentSentenceSource(source)).toThrow(z.ZodError);
  });

  it("rejects persisted unit boundaries that split an emoji surrogate pair", () => {
    expect(() => validateSentenceSourceUnits("😀", [unit("\ud83d"), unit("\ude00", 1)])).toThrow(
      z.ZodError,
    );
    expect(validateSentenceSourceUnits("😀!", [unit("😀!")])).toEqual([unit("😀!")]);
  });
});

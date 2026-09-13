import { describe, expect, it } from "vitest";
import { z } from "zod/v3";
import { completeExpressionSourceRefs } from "./learning-recommendations.js";

describe("complete expression advice evidence", () => {
  it("derives an exact complete expression only after validating the proposed references", () => {
    expect(
      completeExpressionSourceRefs("We keep going.", "keep going", [
        { text: "keep", occurrence: 1 },
      ]),
    ).toEqual([{ text: "keep going", occurrence: 1 }]);
  });

  it("retains valid wider evidence and a model-selected repeated occurrence", () => {
    const refs = [{ text: "can", occurrence: 2 }];
    expect(completeExpressionSourceRefs("can and can", "can", refs)).toEqual(refs);
    expect(
      completeExpressionSourceRefs("We keep going.", "keep going", [
        { text: "We keep going.", occurrence: 1 },
      ]),
    ).toEqual([{ text: "We keep going.", occurrence: 1 }]);
  });

  it("counts overlapping literal matches even when earlier matches lack word boundaries", () => {
    expect(
      completeExpressionSourceRefs("banana ana", "ana", [{ text: "banana", occurrence: 1 }]),
    ).toEqual([{ text: "ana", occurrence: 3 }]);
  });

  it.each(["candy", "écan", "can中", "can_", "can\u0301", "Can"])(
    "does not manufacture full expression evidence in %s",
    (source) => {
      expect(() =>
        completeExpressionSourceRefs(source, "can", [{ text: source, occurrence: 1 }]),
      ).toThrow(z.ZodError);
    },
  );

  it.each([
    [{ text: "elsewhere", occurrence: 1 }],
    [{ text: "can", occurrence: 2 }],
    [
      { text: "We can", occurrence: 1 },
      { text: "can", occurrence: 1 },
    ],
  ])("rejects invalid references even when the expression exists", (...refs) => {
    expect(() => completeExpressionSourceRefs("We can.", "can", refs)).toThrow(z.ZodError);
  });
});

import { describe, expect, it } from "vitest";
import { completePatternSourceRefs } from "./learning-recommendations.js";

const pattern = {
  type: "sentence_pattern",
  template: "{subject} can {action}.",
  slots: [
    { name: "subject", descriptionZh: "主语" },
    { name: "action", descriptionZh: "动作" },
  ],
  functionZh: "说明能力。",
  usageZh: "用于表达能够完成某事。",
};
const values = [
  { name: "subject", text: "We" },
  { name: "action", text: "leave" },
];

describe("complete pattern recommendation source", () => {
  it("selects the terminal occurrence for the existing headline period exception", () => {
    expect(
      completePatternSourceRefs("We can leave; We can leave", pattern, values, [
        { text: "We", occurrence: 1 },
      ]),
    ).toEqual([{ text: "We can leave", occurrence: 2 }]);
  });

  it("preserves an already complete explicit occurrence", () => {
    const refs = [{ text: "We can leave.", occurrence: 2 }];
    expect(completePatternSourceRefs("We can leave. We can leave.", pattern, values, refs)).toEqual(
      refs,
    );
  });

  it.each([
    [{ text: "We", occurrence: 2 }],
    [{ text: "They", occurrence: 1 }],
    [
      { text: "leave", occurrence: 1 },
      { text: "We", occurrence: 1 },
    ],
    [
      { text: "We can", occurrence: 1 },
      { text: "can leave", occurrence: 1 },
    ],
  ])("never rescues an invalid original reference %j", (...refs) => {
    expect(() => completePatternSourceRefs("We can leave.", pattern, values, refs)).toThrow();
  });

  it("rejects source values that reconstruct an absent clause", () => {
    expect(() =>
      completePatternSourceRefs(
        "We can leave.",
        pattern,
        [{ name: "subject", text: "They" }, values[1]],
        [{ text: "We", occurrence: 1 }],
      ),
    ).toThrow();
  });
});

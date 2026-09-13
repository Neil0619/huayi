import { describe, expect, it } from "vitest";
import { z } from "zod/v3";
import { type Candidate } from "./domain-schemas.js";
import {
  assembleLearningRecommendations,
  validateLearningRecommendationSources,
} from "./learning-recommendations.js";

function expression(id = "c1", analysisUnitId = "u1", text = "keep going"): Candidate {
  return {
    id,
    analysisUnitId,
    ordinal: 0,
    type: "expression",
    payload: { type: "expression", text, meaningZh: "坚持下去", usageZh: "用于鼓励继续。" },
  };
}
const units = [{ analysisUnitId: "u1", sourceText: "We keep going." }];
function advice(priority = 1, text = "keep going") {
  return {
    priority,
    sourceRefs: [{ text, occurrence: 1 }],
    useWhenZh: "鼓励对方在困难时继续努力。",
    reasonZh: "可直接用于日常鼓励。",
    generatedExample: {
      sourceText: "Please keep going despite the rain.",
      translationZh: "尽管下雨，也请坚持下去。",
    },
  };
}
function pattern(): Candidate {
  return {
    id: "c2",
    analysisUnitId: "u1",
    ordinal: 0,
    type: "sentence-pattern",
    payload: {
      type: "sentence_pattern",
      template: "{person} keep going.",
      slots: [{ name: "person", descriptionZh: "能够搭配此动词形式的主语。" }],
      usageZh: "表示坚持。",
      functionZh: "说明保持行动。",
    },
  };
}
function patternAdvice() {
  return {
    ...advice(),
    sourceRefs: [{ text: "We keep going.", occurrence: 1 }],
    generatedExample: { sourceText: "They keep going.", translationZh: "他们继续坚持。" },
    exampleValues: [{ name: "person", text: "They" }],
  };
}

describe("source-backed learning recommendations", () => {
  it("uses only explicit advice, keeping ordinary candidates unranked", () => {
    expect(assembleLearningRecommendations(units, [{ candidate: expression() }])).toEqual([]);
    const result = assembleLearningRecommendations(units, [
      { candidate: expression(), advice: advice() },
    ]);
    expect(result).toEqual([
      {
        candidateId: "c1",
        sourceEvidence: [{ text: "keep going", start: 3, end: 13 }],
        useWhenZh: advice().useWhenZh,
        reasonZh: advice().reasonZh,
        generatedExample: advice().generatedExample,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/priority|sourceRefs|exampleValues|sourceValues/u);
  });

  it("orders at most three recommendations globally across sentence units", () => {
    const manyUnits = [1, 2, 3].map((rank) => ({
      analysisUnitId: `u${rank}`,
      sourceText: "We keep going.",
    }));
    const candidates = [3, 1, 2].map((rank) => ({
      candidate: expression(`c${rank}`, `u${rank}`),
      advice: advice(rank),
    }));
    expect(
      assembleLearningRecommendations(manyUnits, candidates).map((item) => item.candidateId),
    ).toEqual(["c1", "c2", "c3"]);
    expect(() =>
      assembleLearningRecommendations(manyUnits, [
        ...candidates,
        { candidate: expression("c4"), advice: advice(1) },
      ]),
    ).toThrow(z.ZodError);
    expect(() =>
      assembleLearningRecommendations(
        manyUnits,
        candidates.map((item) => ({ ...item, advice: advice(1) })),
      ),
    ).toThrow(z.ZodError);
  });

  it("never borrows evidence from another unit or fabricates a candidate ID", () => {
    const otherUnits = [...units, { analysisUnitId: "u2", sourceText: "They left." }];
    for (const unitId of ["u2", "u3"])
      expect(() =>
        assembleLearningRecommendations(otherUnits, [
          { candidate: expression("c1", unitId), advice: advice() },
        ]),
      ).toThrow(z.ZodError);
    expect(() =>
      assembleLearningRecommendations(units, [
        { candidate: expression(), advice: { ...advice(), candidateId: "fake" } },
      ]),
    ).toThrow(z.ZodError);
  });

  it("requires both the source evidence and the new example to use the expression", () => {
    for (const item of [
      { ...advice(), sourceRefs: [{ text: "We", occurrence: 1 }] },
      { ...advice(), sourceRefs: [{ text: "keep moving", occurrence: 1 }] },
      { ...advice(), generatedExample: { sourceText: "I am tired.", translationZh: "我累了。" } },
    ])
      expect(() =>
        assembleLearningRecommendations(units, [{ candidate: expression(), advice: item }]),
      ).toThrow(z.ZodError);
    for (const text of ["party", "art"])
      expect(() =>
        assembleLearningRecommendations(
          [{ analysisUnitId: "u1", sourceText: "The party celebrates art." }],
          [
            {
              candidate: expression("c1", "u1", "art"),
              advice: {
                ...advice(1, text),
                generatedExample: { sourceText: "I like art.", translationZh: "我喜欢艺术。" },
              },
            },
          ],
        ),
      ).toThrow(z.ZodError);
  });

  it("checks source and new example against separate sentence-pattern values", () => {
    const sourceValues = [{ name: "person", text: "We" }];
    const result = assembleLearningRecommendations(units, [
      { candidate: pattern(), advice: patternAdvice(), sourceValues },
    ]);
    expect(result[0]?.generatedExample.sourceText).toBe("They keep going.");
    expect(result[0]?.sourceEvidence).toEqual([{ text: "We keep going.", start: 0, end: 14 }]);
    expect(JSON.stringify(result)).not.toMatch(/sourceValues|exampleValues|priority/u);
    for (const changed of [
      { advice: patternAdvice(), sourceValues: [{ name: "person", text: "They" }] },
      {
        advice: { ...patternAdvice(), exampleValues: [{ name: "person", text: "We" }] },
        sourceValues,
      },
      { advice: { ...patternAdvice(), exampleValues: undefined }, sourceValues },
      {
        advice: { ...patternAdvice(), sourceRefs: [{ text: "keep going", occurrence: 1 }] },
        sourceValues,
      },
      {
        advice: {
          ...patternAdvice(),
          exampleValues: [
            { name: "person", text: "They" },
            { name: "person", text: "They" },
          ],
        },
        sourceValues,
      },
    ])
      expect(() =>
        assembleLearningRecommendations(units, [{ candidate: pattern(), ...changed }]),
      ).toThrow(z.ZodError);
  });

  it("keeps headline evidence literal when the practice template ends with a period", () => {
    const result = assembleLearningRecommendations(
      [{ analysisUnitId: "u1", sourceText: "We keep going" }],
      [
        {
          candidate: pattern(),
          sourceValues: [{ name: "person", text: "We" }],
          advice: { ...patternAdvice(), sourceRefs: [{ text: "We keep going", occurrence: 1 }] },
        },
      ],
    );
    expect(result[0]?.sourceEvidence).toEqual([{ text: "We keep going", start: 0, end: 13 }]);
  });

  it("binds the headline-period exception to the cited terminal occurrence", () => {
    const repeated = [
      { analysisUnitId: "u1", sourceText: "We keep going, although We keep going" },
    ];
    const entry = { candidate: pattern(), sourceValues: [{ name: "person", text: "We" }] };
    expect(() =>
      assembleLearningRecommendations(repeated, [
        {
          ...entry,
          advice: { ...patternAdvice(), sourceRefs: [{ text: "We keep going", occurrence: 1 }] },
        },
      ]),
    ).toThrow(z.ZodError);
    expect(
      assembleLearningRecommendations(repeated, [
        {
          ...entry,
          advice: { ...patternAdvice(), sourceRefs: [{ text: "We keep going", occurrence: 2 }] },
        },
      ])[0]?.sourceEvidence,
    ).toEqual([{ text: "We keep going", start: 24, end: 37 }]);
  });

  it("rejects duplicate identities, invalid priorities, missing fields and private-field injection", () => {
    expect(() =>
      assembleLearningRecommendations(
        [...units, ...units],
        [{ candidate: expression(), advice: advice() }],
      ),
    ).toThrow(z.ZodError);
    expect(() =>
      assembleLearningRecommendations(units, [
        { candidate: expression() },
        { candidate: expression(), advice: advice() },
      ]),
    ).toThrow(z.ZodError);
    for (const item of [
      { ...advice(), priority: 0 },
      { ...advice(), priority: 4 },
      { ...advice(), useWhenZh: "" },
      { ...advice(), reasonZh: "only English" },
      { ...advice(), sourceRefs: [] },
      { ...advice(), exampleValues: [{ name: "person", text: "They" }] },
    ])
      expect(() =>
        assembleLearningRecommendations(units, [{ candidate: expression(), advice: item }]),
      ).toThrow(z.ZodError);
  });

  it("revalidates public source positions and candidate ownership after ID mapping", () => {
    const result = assembleLearningRecommendations(units, [
      { candidate: expression(), advice: advice() },
    ]);
    const item = result[0];
    if (!item) throw new Error("Expected recommendation");
    expect(validateLearningRecommendationSources(units, [expression()], result)).toEqual(result);
    for (const changed of [
      [{ ...item, candidateId: "unknown" }],
      [item, item],
      [{ ...item, sourceEvidence: [{ text: "keep going", start: 2, end: 12 }] }],
      [{ ...item, sourceEvidence: [{ text: "We", start: 0, end: 2 }] }],
      [{ ...item, priority: 1 }],
    ])
      expect(() => validateLearningRecommendationSources(units, [expression()], changed)).toThrow(
        z.ZodError,
      );
    expect(() =>
      validateLearningRecommendationSources(units, [expression("remapped")], result),
    ).toThrow(z.ZodError);
    expect(
      validateLearningRecommendationSources(
        units,
        [expression("remapped")],
        [{ ...item, candidateId: "remapped" }],
      )[0]?.candidateId,
    ).toBe("remapped");
  });
});

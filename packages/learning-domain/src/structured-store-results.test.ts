import { describe, expect, it } from "vitest";
import { z } from "zod/v3";
import { storeAnalysisResultSchema } from "./analysis-results.js";
import { assembleSentenceStructure } from "./teaching-structure.js";
import {
  sentenceExplanationV2ResultSchema,
  storeAnalysisReadResultSchema,
  projectStoreResultForLegacy,
} from "./structured-store-results.js";

const source = "The book that I bought arrived.";
function result() {
  return {
    requestId: "request-1",
    sourceText: source,
    selectionKind: "sentence" as const,
    type: "explain-sentence-v2" as const,
    translationZh: "我买的书到了。",
    contextRole: "说明书已经送到。",
    keyExpressions: [{ text: "arrived", meaningZh: "到了" }],
    sentenceStructures: [
      {
        analysisUnitId: "u1",
        ordinal: 0,
        sourceText: source,
        sentenceStructure: assembleSentenceStructure(source, {
          kind: "sentence",
          coreClauses: [
            {
              fragments: [
                { text: "The book", occurrence: 1 },
                { text: "arrived", occurrence: 1 },
              ],
              explanationZh: "书到了，这是主干。",
            },
          ],
          modifiers: [
            {
              fragments: [{ text: "that I bought", occurrence: 1 }],
              relation: "relative-clause",
              target: { kind: "core", index: 0 },
              explanationZh: "修饰书，说明是我买的那本。",
            },
          ],
        }),
      },
    ],
  };
}

describe("versioned structured Store result", () => {
  it("freezes the old strict result and admits the explicit new version through the read union", () => {
    expect(() => storeAnalysisResultSchema.parse(result())).toThrow(z.ZodError);
    expect(sentenceExplanationV2ResultSchema.parse(result())).toEqual(result());
    expect(storeAnalysisReadResultSchema.parse(result())).toEqual(result());
  });

  it("keeps old strings as old results without inventing native structure", () => {
    const { sentenceStructures, ...base } = result();
    void sentenceStructures;
    const old = {
      ...base,
      type: "explain-sentence" as const,
      mainStructure: "旧主干说明原样保留。",
    };
    expect(storeAnalysisReadResultSchema.parse(old)).toEqual(old);
    expect(projectStoreResultForLegacy(old)).toEqual(old);
    expect(() => sentenceExplanationV2ResultSchema.parse(old)).toThrow(z.ZodError);
  });

  it("deterministically projects new teaching to the old strict payload", () => {
    const before = result();
    const projected = projectStoreResultForLegacy(before);
    expect(storeAnalysisResultSchema.parse(projected)).toEqual(projected);
    expect(projected).toMatchObject({
      type: "explain-sentence",
      requestId: "request-1",
      sourceText: source,
    });
    if (projected.type !== "explain-sentence") throw new Error("Expected sentence projection");
    expect(projected.mainStructure).toContain("The book … arrived");
    expect(projected.mainStructure).toContain("that I bought");
    expect(projected.mainStructure).toContain("修饰书");
    expect(projected).not.toHaveProperty("sentenceStructures");
    expect(before).toEqual(result());
  });

  it("rejects forged source offsets, missing units and invented text after persistence", () => {
    const initial = result();
    const unit = initial.sentenceStructures[0];
    if (!unit) throw new Error("Expected source unit");
    for (const changed of [
      { ...initial, sourceText: `${source} She left.` },
      { ...initial, sentenceStructures: [{ ...unit, ordinal: 1 }] },
      { ...initial, sentenceStructures: [{ ...unit, analysisUnitId: "u2" }] },
      { ...initial, sentenceStructures: [{ ...unit, sourceText: source.toUpperCase() }] },
      {
        ...initial,
        sentenceStructures: [
          {
            ...unit,
            sentenceStructure: {
              ...unit.sentenceStructure,
              coreClauses: [
                {
                  explanationZh: "伪造位置。",
                  fragments: [{ text: "The book", start: 1, end: 9 }],
                },
              ],
            },
          },
        ],
      },
    ])
      expect(() => sentenceExplanationV2ResultSchema.parse(changed)).toThrow(z.ZodError);
  });

  it("bounds legacy text without rejecting otherwise valid large structured teaching", () => {
    const initial = result();
    const unit = initial.sentenceStructures[0];
    if (!unit) throw new Error("Expected source unit");
    const many = Array.from({ length: 12 }, () => ({
      fragments: [{ text: "that I bought", start: 9, end: 22 }],
      relation: "relative-clause" as const,
      target: { kind: "core" as const, index: 0 },
      explanationZh: "长".repeat(500),
    }));
    const projected = projectStoreResultForLegacy({
      ...initial,
      sentenceStructures: [
        { ...unit, sentenceStructure: { ...unit.sentenceStructure, modifiers: many } },
      ],
    });
    if (projected.type !== "explain-sentence") throw new Error("Expected sentence projection");
    expect(projected.mainStructure.length).toBeLessThanOrEqual(4000);
    expect(projected.mainStructure).toContain("省略");
    expect(storeAnalysisResultSchema.parse(projected)).toEqual(projected);
  });

  it("rejects complete multi-unit output beyond the wire budget even though each unit is valid", () => {
    const value = result();
    const unit = value.sentenceStructures[0];
    if (!unit) throw new Error("Expected unit");
    const sentenceStructure = {
      ...unit.sentenceStructure,
      modifiers: Array.from({ length: 12 }, () => ({
        fragments: [{ text: "that I bought", start: 9, end: 22 }],
        relation: "relative-clause" as const,
        target: { kind: "core" as const, index: 0 },
        explanationZh: "长".repeat(500),
      })),
    };
    const changed = {
      ...value,
      sourceText: Array.from({ length: 10 }, () => source).join(" "),
      sentenceStructures: Array.from({ length: 10 }, (_, index) => ({
        ...unit,
        analysisUnitId: `u${index + 1}`,
        ordinal: index,
        sentenceStructure,
      })),
    };
    expect(() => sentenceExplanationV2ResultSchema.parse(changed)).toThrow(/payload budget/u);
  });
});

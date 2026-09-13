import { describe, expect, it } from "vitest";
import { z } from "zod/v3";
import {
  analysisContentSchema,
  analysisRecordSchema,
  webDeepAnalysisSchema,
} from "./domain-schemas.js";
import { assembleSentenceStructure } from "./teaching-structure.js";
import {
  analysisContentReadSchema,
  analysisRecordReadSchema,
  projectAnalysisContentForLegacy,
  projectAnalysisRecordForLegacy,
  structuredAnalysisContentSchema,
  structuredAnalysisRecordSchema,
} from "./structured-web-results.js";

const source = "The book that I bought arrived.";
function content() {
  return {
    sourceText: source,
    sourceNormalizedHash: "a".repeat(64),
    source: { type: "manual" as const },
    selectionKind: "sentence" as const,
    modelMetadata: {
      provider: "deepseek" as const,
      model: "test-model",
      promptVersion: "structured-teaching-1",
      schemaVersion: 3 as const,
    },
    candidates: [
      {
        id: "c1",
        analysisUnitId: "u1",
        ordinal: 0,
        type: "expression" as const,
        payload: {
          type: "expression" as const,
          text: "arrived",
          meaningZh: "到了",
          usageZh: "说明到达。",
        },
      },
    ],
    result: {
      type: "sentence-passage-analysis-v3" as const,
      overall: { translationZh: "我买的书到了。", understandingZh: "交代书的到达。" },
      sentences: [
        {
          analysisUnitId: "u1",
          ordinal: 0,
          sourceText: source,
          translationZh: "我买的书到了。",
          candidateIds: ["c1"],
          grammar: [],
          expressions: [],
          languageNotes: [],
          sentenceStructure: assembleSentenceStructure(source, {
            kind: "sentence",
            coreClauses: [
              {
                fragments: [
                  { text: "The book", occurrence: 1 },
                  { text: "arrived", occurrence: 1 },
                ],
                explanationZh: "主干交代书的到达。",
              },
            ],
            modifiers: [
              {
                fragments: [{ text: "that I bought", occurrence: 1 }],
                target: { kind: "core", index: 0 },
                relation: "relative-clause",
                explanationZh: "说明是哪本书。",
              },
            ],
          }),
        },
      ],
      recommendations: [
        {
          candidateId: "c1",
          sourceEvidence: [{ text: "arrived", start: 23, end: 30 }],
          useWhenZh: "说明某人或物已到达。",
          reasonZh: "适合报告进展。",
          generatedExample: {
            sourceText: "Our guests arrived early.",
            translationZh: "客人们提前到了。",
          },
        },
      ],
    },
  };
}
function record() {
  return {
    ...content(),
    id: "analysis-1",
    createdAt: "2026-09-12T10:00:00Z",
    updatedAt: "2026-09-12T10:00:00Z",
    revision: 1,
    archivedAt: null,
    reviewState: "pendingReview" as const,
  };
}

describe("versioned structured Web analysis", () => {
  it("keeps old schemas frozen while the read unions accept explicit v3 content and records", () => {
    expect(() => analysisContentSchema.parse(content())).toThrow(z.ZodError);
    expect(() => webDeepAnalysisSchema.parse(content().result)).toThrow(z.ZodError);
    expect(() => analysisRecordSchema.parse(record())).toThrow(z.ZodError);
    expect(structuredAnalysisContentSchema.parse(content())).toEqual(content());
    expect(analysisContentReadSchema.parse(content())).toEqual(content());
    expect(analysisRecordReadSchema.parse(record())).toEqual(record());
  });

  it("projects new teaching without presenting discontinuous fragments as a continuous quote", () => {
    const projected = projectAnalysisRecordForLegacy(record());
    expect(analysisRecordSchema.parse(projected)).toEqual(projected);
    expect(projected.modelMetadata.schemaVersion).toBe(3);
    expect(projected).toMatchObject({
      id: "analysis-1",
      revision: 1,
      reviewState: "pendingReview",
      archivedAt: null,
    });
    if (projected.result.type !== "sentence-passage-analysis-v2")
      throw new Error("Expected old sentence result");
    expect(projected.result).not.toHaveProperty("recommendations");
    expect(projected.result.sentences[0]?.structure[0]).not.toHaveProperty("evidenceText");
    expect(projected.result.sentences[0]?.structure[0]?.explanationZh).toContain(
      "The book … arrived",
    );
    expect(projected.result.sentences[0]?.structure[1]?.evidenceText).toBe("that I bought");
    expect(projectAnalysisRecordForLegacy(projected)).toEqual(projected);
  });

  it("preserves old records without inferring new teaching or recommendations", () => {
    const old = projectAnalysisContentForLegacy(content());
    expect(analysisContentReadSchema.parse(old)).toEqual(old);
    expect(projectAnalysisContentForLegacy(old)).toEqual(old);
    expect(() => structuredAnalysisContentSchema.parse(old)).toThrow(z.ZodError);
  });

  it("rejects missing source, bad unit identity, invalid offsets and wrong metadata version", () => {
    const initial = content();
    const sentence = initial.result.sentences[0];
    if (!sentence) throw new Error("Expected sentence");
    for (const changed of [
      { ...initial, sourceText: `${source} Then she left.` },
      { ...initial, modelMetadata: { ...initial.modelMetadata, schemaVersion: 2 } },
      { ...initial, selectionKind: "phrase" },
      {
        ...initial,
        result: { ...initial.result, sentences: [{ ...sentence, analysisUnitId: "u2" }] },
      },
      { ...initial, result: { ...initial.result, sentences: [{ ...sentence, ordinal: 1 }] } },
      {
        ...initial,
        result: {
          ...initial.result,
          sentences: [{ ...sentence, sourceText: source.toUpperCase() }],
        },
      },
    ])
      expect(() => structuredAnalysisContentSchema.parse(changed)).toThrow(z.ZodError);
  });

  it("retains the existing complete candidate-reference invariants in new results", () => {
    const initial = content();
    const sentence = initial.result.sentences[0];
    const candidate = initial.candidates[0];
    if (!sentence || !candidate) throw new Error("Expected teaching data");
    for (const changed of [
      { ...initial, candidates: [candidate, candidate] },
      { ...initial, candidates: [{ ...candidate, ordinal: 1 }] },
      { ...initial, candidates: [{ ...candidate, analysisUnitId: "u2" }] },
      { ...initial, result: { ...initial.result, sentences: [{ ...sentence, candidateIds: [] }] } },
      {
        ...initial,
        result: { ...initial.result, sentences: [{ ...sentence, candidateIds: ["unknown"] }] },
      },
    ])
      expect(() => structuredAnalysisContentSchema.parse(changed)).toThrow(z.ZodError);
  });

  it("rejects dangling recommendations and evidence attributed to a different candidate", () => {
    const initial = content();
    const recommendation = initial.result.recommendations[0];
    if (!recommendation) throw new Error("Expected recommendation");
    for (const changed of [
      { ...recommendation, candidateId: "unknown" },
      { ...recommendation, sourceEvidence: [{ text: "The book", start: 0, end: 8 }] },
      { ...recommendation, sourceEvidence: [{ text: "arrived", start: 22, end: 29 }] },
    ])
      expect(() =>
        structuredAnalysisRecordSchema.parse({
          ...record(),
          result: { ...initial.result, recommendations: [changed] },
        }),
      ).toThrow(z.ZodError);
  });

  it("supports phrase v3 recommendations and projects back to frozen phrase v2", () => {
    const value = {
      ...content(),
      sourceText: "arrived",
      selectionKind: "phrase" as const,
      result: {
        type: "phrase-analysis-v3" as const,
        analysisUnitId: "u1" as const,
        candidateIds: ["c1"],
        contextualMeaningZh: "到了",
        translationZh: "到了",
        structureAndCollocationZh: [],
        usageNotes: [],
        recommendations: [],
      },
    };
    expect(structuredAnalysisContentSchema.parse(value)).toEqual(value);
    expect(projectAnalysisContentForLegacy(value).result.type).toBe("phrase-analysis-v2");
  });

  it("rejects an assembled teaching payload that fits individual fields but exceeds wire budgets", () => {
    const value = content();
    const sentence = value.result.sentences[0];
    if (!sentence) throw new Error("Expected sentence");
    const points = Array.from({ length: 20 }, () => ({
      label: "说明",
      explanationZh: "中".repeat(2000),
    }));
    const changed = {
      ...value,
      result: {
        ...value.result,
        sentences: [{ ...sentence, grammar: points, expressions: points }],
      },
    };
    expect(() => structuredAnalysisContentSchema.parse(changed)).toThrow(/payload budget/u);
    expect(() => structuredAnalysisRecordSchema.parse({ ...record(), ...changed })).toThrow(
      /payload budget/u,
    );
  });
});

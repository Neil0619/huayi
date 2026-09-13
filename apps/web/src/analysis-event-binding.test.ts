import {
  contractFixtures,
  analysisEventReadSchema,
  assembleSentenceStructure,
  type AnalysisEventRead,
} from "@huayi/cloud-contracts";
import { expect, it } from "vitest";
import { createAnalysisEventBinding } from "./analysis-event-binding.js";
import { nativeWebAnalysis } from "./native-analysis.test-support.js";
function fixture() {
  const record = nativeWebAnalysis();
  if (record.result.type !== "sentence-passage-analysis-v3") throw new Error("fixture");
  const structures = record.result.sentences.map((sentence) => ({
    type: "analysis.structure" as const,
    requestId: "request-1",
    unit: {
      analysisUnitId: sentence.analysisUnitId,
      ordinal: sentence.ordinal,
      sourceText: sentence.sourceText,
      sentenceStructure: sentence.sentenceStructure,
    },
  }));
  const complete: AnalysisEventRead = { ...contractFixtures.completedEvent, analysis: record };
  return {
    record,
    structures,
    complete,
    bind: () =>
      createAnalysisEventBinding({ sourceText: record.sourceText, selectionKind: "passage" }),
  };
}
it("accepts sparse ordered native units and snapshot-only completion", () => {
  const f = fixture();
  const binding = f.bind();
  const second = f.structures[1];
  if (!second) throw new Error("fixture");
  expect(binding.accept(second)).toEqual(second);
  expect(binding.accept(f.complete)).toEqual(f.complete);
  expect(f.bind().accept(f.complete)).toEqual(f.complete);
});
it("does not retain a rejected first frame's request identity when the valid source is reread", () => {
  const f = fixture();
  const first = f.structures[0];
  const second = f.structures[1];
  if (!first || !second) throw new Error("fixture");
  const foreign = analysisEventReadSchema.parse({
    type: "analysis.structure",
    requestId: "foreign-request",
    unit: {
      analysisUnitId: "u1",
      ordinal: 0,
      sourceText: "Birds fly.",
      sentenceStructure: assembleSentenceStructure("Birds fly.", {
        kind: "sentence",
        modifiers: [],
        coreClauses: [
          { fragments: [{ text: "Birds fly", occurrence: 1 }], explanationZh: "鸟会飞。" },
        ],
      }),
    },
  });
  const binding = f.bind();
  expect(() => binding.accept(foreign)).toThrow();
  expect(binding.accept(first)).toEqual(first);
  expect(() => binding.accept({ ...second, requestId: "another-request" })).toThrow();
  expect(binding.accept(second)).toEqual(second);
  expect(binding.accept(f.complete)).toEqual(f.complete);
});
it.each(["request", "source", "order", "duplicate", "terminal", "capture", "kind", "agreement"])(
  "rejects a foreign or contradictory %s without accepting its result",
  (scenario) => {
    const f = fixture();
    const first = f.structures[0];
    if (!first) throw new Error("fixture");
    const binding =
      scenario === "capture"
        ? createAnalysisEventBinding({
            sourceText: f.record.sourceText,
            selectionKind: "passage",
            captureId: "capture-expected",
          })
        : f.bind();
    binding.accept(first);
    if (scenario === "request")
      expect(() =>
        binding.accept({
          ...first,
          requestId: "other",
          unit: { ...first.unit, ordinal: 1, analysisUnitId: "u2" },
        }),
      ).toThrow();
    if (scenario === "source")
      expect(() =>
        f.bind().accept({ ...first, unit: { ...first.unit, sourceText: "Other original." } }),
      ).toThrow();
    if (scenario === "order" || scenario === "duplicate")
      expect(() => binding.accept(first)).toThrow();
    if (scenario === "terminal") {
      binding.accept(f.complete);
      expect(() => binding.accept(first)).toThrow();
    }
    if (scenario === "capture") expect(() => binding.accept(f.complete)).toThrow();
    if (scenario === "kind")
      expect(() =>
        binding.accept({
          ...f.complete,
          analysis: { ...f.record, selectionKind: "sentence" },
        } as AnalysisEventRead),
      ).toThrow();
    if (scenario === "agreement") {
      const changed = structuredClone(f.record);
      if (
        changed.result.type !== "sentence-passage-analysis-v3" ||
        !changed.result.sentences[0]?.sentenceStructure.coreClauses[0]
      )
        throw new Error("fixture");
      changed.result.sentences[0].sentenceStructure.coreClauses[0].explanationZh =
        "另一份互相矛盾的说明。";
      expect(() =>
        binding.accept({ ...f.complete, analysis: changed } as AnalysisEventRead),
      ).toThrow();
    }
  },
);
it("binds terminal raw source, including surrounding whitespace", () => {
  const f = fixture();
  expect(() =>
    createAnalysisEventBinding({
      sourceText: f.record.sourceText.trim(),
      selectionKind: "passage",
    }).accept(f.complete),
  ).toThrow();
});
it("requires native terminal output for an opted-in new stream while reading old recovered results", () => {
  const input = contractFixtures.startAnalysisRequest;
  const completed = analysisEventReadSchema.parse(contractFixtures.completedEvent);
  expect(() =>
    createAnalysisEventBinding({ ...input, requireStructured: true }).accept(completed),
  ).toThrow();
  expect(createAnalysisEventBinding(input).accept(completed)).toEqual(
    contractFixtures.completedEvent,
  );
});

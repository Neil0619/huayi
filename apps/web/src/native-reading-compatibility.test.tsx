import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { structuredAnalysisRecordSchema } from "@huayi/cloud-contracts";
import { DeepAnalysisReading } from "./deep-analysis-reading.js";
import { CollectionReview } from "./collection-review.js";
import { nativeWebAnalysis } from "./native-analysis.test-support.js";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
async function render(element: React.ReactNode) {
  const view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  await act(async () => root?.render(element));
  return view;
}
it("reads native phrase teaching without taking the sentence branch", async () => {
  const record = structuredAnalysisRecordSchema.parse({
    ...nativeWebAnalysis(),
    sourceText: "to be frank",
    selectionKind: "phrase",
    candidates: [],
    result: {
      type: "phrase-analysis-v3",
      analysisUnitId: "u1",
      candidateIds: [],
      translationZh: "坦率地说",
      contextualMeaningZh: "表达个人看法。",
      structureAndCollocationZh: ["to be + 形容词"],
      usageNotes: [],
      recommendations: [],
    },
  });
  const view = await render(<DeepAnalysisReading analysis={record} />);
  expect(view.textContent).toContain("坦率地说");
  expect(view.textContent).toContain("to be + 形容词");
  expect(view.querySelector("[data-native-unit]")).toBeNull();
  expect(view.textContent).not.toContain("undefined");
});
it.each([0, 1, 3])(
  "shows exactly %s recommendations while preserving every other candidate",
  async (count) => {
    const record = nativeWebAnalysis();
    const firstUnit =
      record.result.type === "sentence-passage-analysis-v3"
        ? record.result.sentences[0]
        : undefined;
    if (!firstUnit) throw new Error("fixture");
    const start = firstUnit.sourceText.indexOf("recommended");
    record.result.recommendations = [
      ...record.result.recommendations,
      {
        candidateId: "20000000-0000-4000-8000-000000000001",
        sourceEvidence: [{ text: "recommended", start, end: start + 11 }],
        reasonZh: "分享好去处时常用。",
        useWhenZh: "向朋友说明推荐来源。",
        generatedExample: {
          sourceText: "She recommended this shop.",
          translationZh: "她推荐了这家店。",
        },
      },
    ].slice(0, count);
    const view = await render(
      <CollectionReview
        analysis={structuredAnalysisRecordSchema.parse(record)}
        draftCache={new Map()}
        api={{
          listPending: vi.fn(),
          getAnalysis: vi.fn(),
          confirmCandidates: vi.fn(),
          processNothingToSave: vi.fn(),
        }}
        idempotencyKey={() => "offline"}
        onSaved={vi.fn()}
      />,
    );
    expect(view.querySelectorAll("[data-recommendation]")).toHaveLength(count);
    expect(view.querySelectorAll(".collection-candidate")).toHaveLength(4);
    expect(view.querySelectorAll("input:checked")).toHaveLength(0);
  },
);
it("renders model supplied HTML-like teaching literally", async () => {
  const record = nativeWebAnalysis();
  const core =
    record.result.type === "sentence-passage-analysis-v3"
      ? record.result.sentences[0]?.sentenceStructure.coreClauses[0]
      : undefined;
  if (!core) throw new Error("fixture");
  core.explanationZh = '<img src=x onerror="alert(1)"> 这是中文结构说明。';
  const view = await render(<DeepAnalysisReading analysis={record} />);
  expect(view.textContent).toContain(core.explanationZh);
  expect(view.querySelector("img")).toBeNull();
});

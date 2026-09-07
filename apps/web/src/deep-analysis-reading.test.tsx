import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  analysisRecordSchema,
  contractFixtures,
  type AnalysisRecord,
} from "@huayi/cloud-contracts";

import { DeepAnalysisReading } from "./deep-analysis-reading.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(analysis: AnalysisRecord) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => createRoot(container).render(<DeepAnalysisReading analysis={analysis} />));
  return container;
}

function passage() {
  return analysisRecordSchema.parse(contractFixtures.analysis);
}

const point = {
  label: "不定式完成式",
  evidenceText: "to have been caused",
  explanationZh: "火灾的起因发生在报道之前。",
  commonMistakeZh: "不要把推测理解为已经证实的结论。",
  generatedExample: {
    sourceText: "The delay appeared to have been caused by rain.",
    translationZh: "延误似乎是下雨造成的。",
  },
};

describe("deep analysis reading hierarchy", () => {
  beforeEach(() => document.body.replaceChildren());

  it.each([
    [
      "这条新闻说，西班牙南部的一场野火已导致至少12人死亡、23人失踪。",
      "西班牙南部的一场野火已造成至少12人死亡、23人失踪。",
    ],
    [
      "数百人正努力控制一场火灾，火灾疑似由一根坠落的电线引起。",
      "数百人正努力控制这场火灾，火灾疑似由一根坠落的电线引起。",
    ],
  ])(
    "keeps one primary translation and preserves near-duplicate understanding in closed details",
    async (understandingZh, translationZh) => {
      const analysis = passage();
      if (analysis.result.type !== "sentence-passage-analysis-v2")
        throw new Error("Expected passage");
      analysis.result.overall = {
        understandingZh,
        translationZh,
        contextAndToneZh: "新闻报道，起因尚未确认。",
      };
      const container = await render(analysis);
      const understanding = [...container.querySelectorAll("p")].find(
        (node) => node.textContent === understandingZh,
      );
      expect(understanding?.closest("details")?.open).toBe(false);
      expect(container.querySelector(".analysis-reading-translation")?.textContent).toBe(
        translationZh,
      );
      const context = container.querySelector<HTMLDetailsElement>(".analysis-reading-context");
      expect(context?.open).toBe(false);
      expect(context?.textContent).toContain(understandingZh);
      expect(context?.textContent).toContain("新闻报道，起因尚未确认。");
      expect(container.querySelector(".deep-analysis-reading")).not.toBeNull();
    },
  );

  it("groups explanations around quoted evidence, pitfalls and explicitly generated examples", async () => {
    const analysis = passage();
    if (analysis.result.type !== "sentence-passage-analysis-v2")
      throw new Error("Expected passage");
    const sentence = analysis.result.sentences[0];
    if (!sentence) throw new Error("Expected sentence");
    sentence.sourceText = "The fire appeared to have been caused by lightning.";
    sentence.grammar = [point];
    const container = await render(analysis);
    expect(container.querySelector(".analysis-reading-sentence > summary")?.textContent).toContain(
      "01",
    );
    expect(container.querySelector(".analysis-reading-sentence > summary")?.textContent).toContain(
      "展开解析",
    );
    expect(container.querySelector(".analysis-teaching-evidence")?.textContent).toContain(
      point.evidenceText,
    );
    expect(container.querySelector(".analysis-teaching-pitfall")?.textContent).toContain(
      point.commonMistakeZh,
    );
    expect(container.querySelector(".analysis-teaching-example")?.textContent).toContain(
      "生成示例",
    );
    expect(container.textContent).toContain(point.generatedExample.translationZh);
    expect(container.querySelectorAll(".analysis-teaching-group")).toHaveLength(2);
  });

  it("renders phrase collocations, register and every usage note", async () => {
    const analysis = passage();
    analysis.selectionKind = "phrase";
    analysis.sourceText = "to be frank";
    analysis.result = {
      type: "phrase-analysis-v2",
      analysisUnitId: "u1",
      candidateIds: [],
      translationZh: "坦率地说",
      contextualMeaningZh: "用于直接表达自己的看法。",
      register: "中性，口语和写作均可",
      structureAndCollocationZh: ["to be + 形容词"],
      usageNotes: [
        { ...point, evidenceText: "to be frank" },
        { label: "语气", explanationZh: "直接但并非无礼。" },
      ],
    };
    const container = await render(analysis);
    expect(container.querySelector(".analysis-reading-translation")?.textContent).toBe("坦率地说");
    for (const text of [
      "中性，口语和写作均可",
      "to be + 形容词",
      "to be frank",
      "直接但并非无礼。",
    ])
      expect(container.textContent).toContain(text);
    expect(container.querySelector<HTMLDetailsElement>(".analysis-reading-context")?.open).toBe(
      false,
    );
  });

  it("reads legacy points without optional evidence and omits empty groups without inventing content", async () => {
    const container = await render(passage());
    expect(container.textContent).toContain("插入语加主句。");
    expect(container.querySelectorAll(".analysis-teaching-group")).toHaveLength(2);
    expect(container.querySelector(".analysis-teaching-evidence")).toBeNull();
    expect(container.querySelector(".analysis-teaching-example")).toBeNull();
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("使用提醒");
  });

  it("does not present rewritten legacy evidence as a quote from the selected sentence", async () => {
    const analysis = passage();
    if (analysis.result.type !== "sentence-passage-analysis-v2")
      throw new Error("Expected passage");
    const sentence = analysis.result.sentences[0];
    if (!sentence) throw new Error("Expected sentence");
    sentence.grammar = [
      { label: "旧解析", evidenceText: "To be ... works", explanationZh: "原有解释仍然保留。" },
    ];
    const container = await render(analysis);
    expect(container.querySelector(".analysis-teaching-evidence")).toBeNull();
    expect(container.textContent).toContain("原有解释仍然保留。");
  });

  it.each([
    ["US officials agreed.", "us"],
    ["She speaks Polish.", "polish"],
    ["The area is 10² square metres.", "102"],
  ])(
    "does not change source meaning through quote normalization: %s",
    async (sourceText, evidenceText) => {
      const analysis = passage();
      if (analysis.result.type !== "sentence-passage-analysis-v2")
        throw new Error("Expected passage");
      const sentence = analysis.result.sentences[0];
      if (!sentence) throw new Error("Expected sentence");
      sentence.sourceText = sourceText;
      sentence.grammar = [{ label: "原文引用", evidenceText, explanationZh: "保留解释。" }];
      const container = await render(analysis);
      expect(container.querySelector(".analysis-teaching-evidence")).toBeNull();
      expect(container.textContent).toContain("保留解释。");
    },
  );
});

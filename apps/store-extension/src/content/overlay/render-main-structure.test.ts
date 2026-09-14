import { describe, expect, it } from "vitest";

import { renderAnalysisResult } from "./render-analysis-result.js";
import { renderResultSection } from "./render-result-sections.js";
import { previewTextSection } from "./result-section-specs.js";
import { renderStreamPreview, renderStreamStatus } from "./render-stream-preview.js";

const structure =
  "主句为“US President Donald Trump says...”，其中says后接宾语从句“he would offer every adult American a $5,000 (£3,700) payout”；该宾语从句内含if引导的条件状语从句“if Republicans win both chambers of Congress in November's midterm elections”；破折号后“a plan that would cost more than a trillion dollars”为同位语，对前面的计划作补充说明，其中that引导定语从句修饰 plan。";
const screenshot =
  "该段落由两个句子组成。第一句主干为“He gave no details”，其中“on how it would work or be funded”是介词短语作后置定语，修饰“details”，说明未提供细节的具体方面；“saying only that...”为现在分词短语作伴随状语，that引导宾语从句，从句主干为“the money would have to be spent”，地点状语“in the US”说明资金使用地。第二句主干为“Vice-President JD Vance has linked the plan to the revenue”，其中“that Trump has raised from US tariffs on imported goods”是that引导的定语从句，修饰“revenue”，说明该收入的来源。";

function render(value: string) {
  return renderResultSection(document, previewTextSection("main-structure", value));
}
function original(section: HTMLElement) {
  return section.querySelector(".notes")?.textContent;
}

function result(mainStructure: string, requestId = "request-1") {
  return {
    requestId,
    sourceText: "Example.",
    selectionKind: "sentence" as const,
    type: "explain-sentence" as const,
    mainStructure,
    translationZh: "示例。",
    contextRole: "说明。",
    keyExpressions: [],
  };
}

describe("sentence structure presentation", () => {
  it("shows exactly the two explicit screenshot main clauses, with all explanation collapsed", () => {
    const section = render(screenshot);
    expect([...section.querySelectorAll(".core strong")].map((node) => node.textContent)).toEqual([
      "He gave no details",
      "Vice-President JD Vance has linked the plan to the revenue",
    ]);
    expect([...section.querySelectorAll(".core small")].map((node) => node.textContent)).toEqual([
      "第一句",
      "第二句",
    ]);
    expect(section.querySelectorAll("details")).toHaveLength(1);
    expect(section.querySelector("details")?.open).toBe(false);
    expect(section.querySelector("summary")?.textContent).toBe("查看结构说明");
    expect(original(section)).toBe(screenshot);
    expect(section.querySelector(".notes strong")).toBeNull();
    expect(section.querySelectorAll(".notes p")).toHaveLength(4);
  });

  it("supports the original single main clause without comma fragmentation or keyword emphasis", () => {
    const section = render(structure);
    expect(section.querySelector(".core strong")?.textContent).toBe(
      "US President Donald Trump says...",
    );
    expect(section.querySelectorAll(".core")).toHaveLength(1);
    expect(section.querySelectorAll(".notes p")).toHaveLength(3);
    expect(original(section)).toBe(structure);
  });

  it.each([
    "主语 + 系动词 + 表语",
    "这是一般说明，从句主干为“we agree”。",
    "从句主干为“we agree”。",
    "其中主干为“we agree”。",
    "例如主句为“we agree”。",
    "主句为“unfinished 宾语从句",
    "主句为‘中文说明’。",
    '<img src=x onerror="alert(1)">',
  ])("keeps unsupported or incomplete text fully visible and safe: %s", (value) => {
    const section = render(value);
    expect(original(section)).toBe(value);
    expect(section.querySelector("details, strong, img")).toBeNull();
  });

  it.each([
    "主句是“we agree”。",
    "主句：“we agree”。",
    "主干为‘Don’t split; this clause，please’；另一部分。",
    "主句为“she said ‘hello；world’”。\n补充说明。",
    "主句为“Don't split; this clause，please”；另一部分。",
    "主句为'November's elections matter';说明。",
    "主句为“<img src=x onerror=alert(1)>”。",
  ])("keeps quoted punctuation and markup as text: %s", (value) => {
    const section = render(value);
    expect(original(section)).toBe(value);
    expect(section.querySelectorAll(".core")).toHaveLength(1);
    expect(section.querySelector("img")).toBeNull();
  });

  it("preserves every streaming prefix in the full explanation", () => {
    for (let end = 1; end <= screenshot.length; end += 1) {
      const prefix = screenshot.slice(0, end);
      expect(original(render(prefix))).toBe(prefix);
    }
  });

  it.each([true, false])(
    "retains disclosure node, open=%s and keyboard focus through delta and final, resets for a new request",
    (open) => {
      const body = document.createElement("div");
      document.body.append(body);
      renderStreamStatus(body);
      const preview = (text: string) =>
        renderStreamPreview(body, new Map([["main-structure", text]]), new Map());
      preview(structure);
      const details = body.querySelector("details");
      const summary = body.querySelector("summary");
      expect(details).not.toBeNull();
      if (!details || !summary) throw new Error("Missing disclosure");
      details.open = open;
      summary.focus();
      preview(`${structure}补充说明。`);
      expect(body.querySelector("details")).toBe(details);
      expect(details.open).toBe(open);
      expect(document.activeElement).toBe(summary);
      renderAnalysisResult(body, result(`${structure}最终说明。`));
      expect(body.querySelector("details")).toBe(details);
      expect(details.open).toBe(open);
      expect(document.activeElement).toBe(summary);
      expect(original(body)).toBe(`${structure}最终说明。`);
      renderStreamStatus(body);
      preview(screenshot);
      expect(body.querySelector("details")).not.toBe(details);
      expect(body.querySelector("details")?.open).toBe(false);
      body.remove();
    },
  );

  it("does not retain a disclosure between different final requests", () => {
    const body = document.createElement("div");
    renderAnalysisResult(body, result(structure));
    const details = body.querySelector("details");
    if (details) details.open = true;
    renderAnalysisResult(body, result(screenshot, "request-2"));
    expect(body.querySelector("details")).not.toBe(details);
    expect(body.querySelector("details")?.open).toBe(false);
  });
});

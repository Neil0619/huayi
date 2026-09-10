import { describe, expect, it } from "vitest";

import { renderResultSection } from "./render-result-sections.js";
import { previewTextSection, resultSections } from "./result-section-specs.js";

const structure =
  "主句为“US President Donald Trump says...”，其中says后接宾语从句“he would offer every adult American a $5,000 (£3,700) payout”；该宾语从句内含if引导的条件状语从句“if Republicans win both chambers of Congress in November's midterm elections”；破折号后“a plan that would cost more than a trillion dollars”为同位语，对前面的计划作补充说明，其中that引导定语从句修饰 plan。";

function render(value: string) {
  return renderResultSection(document, previewTextSection("main-structure", value));
}

describe("sentence structure presentation", () => {
  it("turns the dense screenshot text into readable clauses without changing a character", () => {
    const section = render(structure);
    const paragraphs = [...section.querySelectorAll("p")];
    expect(paragraphs.length).toBeGreaterThanOrEqual(4);
    expect(paragraphs.map((item) => item.textContent).join("")).toBe(structure);
    expect(section.querySelector("strong")?.textContent).toBe("主句");
    expect(section.querySelectorAll(".structure-quote")).toHaveLength(4);
    expect(section.querySelector("strong")?.textContent).not.toContain("US President");
  });

  it.each([
    "主语：“Alice; Bob，and Carol”；谓语：agree。",
    "主语：'Alice and Bob'; 谓语：agree。",
    "主句为‘Don’t split; this clause，please’；另一部分。",
    "主句为“she said ‘hello；world’”。\n补充说明。",
    "主句为“Don't split; this clause，please”；另一部分。",
  ])("keeps quoted punctuation inside its clause: %s", (value) => {
    const section = render(value);
    expect(section.querySelectorAll("p")).toHaveLength(2);
    expect([...section.querySelectorAll("p")].map((item) => item.textContent).join("")).toBe(value);
  });

  it("emphasizes existing grammar terms outside quotes without labeling unstructured prose", () => {
    const value =
      "主句为“the subject says 主语 and 宾语从句”；其中后接宾语从句，并含条件状语从句；补充同位语，其中定语从句修饰 plan。";
    const section = render(value);
    expect(section.textContent).toBe(`句子主干${value}`);
    expect([...section.querySelectorAll("strong")].map((item) => item.textContent)).toEqual([
      "主句",
      "宾语从句",
      "条件状语从句",
      "同位语",
      "定语从句",
    ]);
    expect(section.querySelector(".structure-quote strong")).toBeNull();
    expect(section.querySelector("p")?.hasAttribute("data-structure-main")).toBe(true);
    for (const text of [
      "“主语”作表语。",
      "主句为“unfinished 宾语从句",
      "这是一般说明。",
      "主语 + 系动词 + 表语",
    ]) {
      const rendered = render(text);
      expect(rendered.textContent).toBe(`句子主干${text}`);
      if (text.startsWith("主句为")) {
        expect([...rendered.querySelectorAll("strong")].map((item) => item.textContent)).toEqual([
          "主句",
        ]);
      } else {
        expect(rendered.querySelector("[data-structure-main]")).toBeNull();
      }
    }
    expect(
      [...render("“主语”作表语。").querySelectorAll("strong")].map((item) => item.textContent),
    ).toEqual(["表语"]);
  });

  it("preserves unstructured and incomplete streamed text, including hostile markup", () => {
    for (const value of [
      "主语 + 系动词 + 表语",
      "主句为“we wait; for",
      '<img src=x onerror="alert(1)">',
    ]) {
      const section = render(value);
      expect(section.querySelectorAll("p")).toHaveLength(1);
      expect(section.textContent).toBe(`句子主干${value}`);
      expect(section.querySelector("img")).toBeNull();
    }
    for (let end = 1; end <= structure.length; end += 1) {
      const prefix = structure.slice(0, end);
      expect(render(prefix).textContent).toBe(`句子主干${prefix}`);
    }
  });

  it("uses the same presentation for the final result and leaves other prose alone", () => {
    const spec = resultSections({
      requestId: "request-1",
      sourceText: "Example.",
      selectionKind: "sentence",
      type: "explain-sentence",
      mainStructure: structure,
      translationZh: "示例。",
      contextRole: "说明。",
      keyExpressions: [],
    })[0];
    if (!spec) throw new Error("Missing structure section");
    expect(renderResultSection(document, spec).innerHTML).toBe(render(structure).innerHTML);
    const translation = renderResultSection(document, previewTextSection("translation", structure));
    expect(translation.querySelectorAll("p")).toHaveLength(1);
    expect(translation.querySelector("strong")).toBeNull();
  });
});

import { expect, test } from "@playwright/test";
import { analysisRecordSchema, contractFixtures } from "@huayi/cloud-contracts";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";
import { cloudCors } from "./support/cloud-browser-authority-request.js";

const sourceText =
  "Hundreds of people are trying to contain the fire, which Moreno said appeared to have been caused by a downed power line. The flames then spread in a wooded area around Los Gallardos, Almería.";
const firstSentence = sourceText.split(". ")[0] + ".";
const translation =
  "数百人正努力控制这场火灾，据莫雷诺称，火灾疑似由一根坠落的电线引起。火焰随后蔓延至阿尔梅里亚洛斯加亚尔多斯附近的林区。";
const understanding =
  "数百人正努力控制一场火灾，据莫雷诺称，火灾疑似由一根坠落的电线引起。火焰随后蔓延至阿尔梅里亚洛斯加亚尔多斯附近的林区。";

function readingRecord(headline = false) {
  const analysis = analysisRecordSchema.parse(contractFixtures.analysis);
  if (analysis.result.type !== "sentence-passage-analysis-v2") throw new Error("Expected passage");
  analysis.sourceText = headline
    ? "Wildfire in southern Spain leaves at least 12 dead and 23 missing"
    : sourceText;
  analysis.result.overall = {
    translationZh: headline ? "西班牙南部的一场野火已造成至少12人死亡、23人失踪。" : translation,
    understandingZh: headline
      ? "这条新闻说，西班牙南部的一场野火已导致至少12人死亡、23人失踪。"
      : understanding,
    contextAndToneZh: "新闻报道采用审慎语气，火灾起因尚未确认。",
  };
  analysis.source = { title: "Wildfire news", type: "manual" };
  const candidate = analysis.candidates[0];
  if (candidate?.type === "expression") {
    candidate.payload = {
      type: "expression",
      text: headline ? "at least" : "contain the fire",
      meaningZh: headline ? "至少" : "控制火势",
      usageZh: headline ? "说明最低数量。" : "描述控制火势、阻止蔓延。",
    };
  }
  const sentence = analysis.result.sentences[0];
  if (!sentence) throw new Error("Expected sentence");
  sentence.sourceText = headline ? analysis.sourceText : firstSentence;
  sentence.translationZh = headline
    ? analysis.result.overall.translationZh
    : "数百人正努力控制这场火灾，据莫雷诺称，火灾疑似由一根坠落的电线引起。";
  sentence.structure = [
    {
      label: "主句",
      evidenceText: "Hundreds of people are trying to contain the fire",
      explanationZh: "主句说明数百人正在努力控制火势。",
    },
    {
      label: "非限制性定语从句",
      evidenceText: "which Moreno said appeared to have been caused by a downed power line",
      explanationZh: "which 引导从句，补充说明火灾的原因；Moreno said 交代信息来源。",
    },
  ];
  sentence.grammar = [
    {
      label: "不定式完成式与被动语态",
      evidenceText: "to have been caused",
      explanationZh: "起因发生在报道之前；被动语态强调火灾是被引起的。",
      commonMistakeZh: "appeared 保留推测意味，不要理解为起因已经得到证实。",
      generatedExample: {
        sourceText: "The delay appeared to have been caused by rain.",
        translationZh: "延误似乎是下雨造成的。",
      },
    },
  ];
  sentence.expressions = [
    {
      label: "控制火势",
      evidenceText: "contain the fire",
      explanationZh: "contain 与 fire 搭配，表示控制火势、阻止蔓延。",
    },
  ];
  sentence.languageNotes = [
    {
      label: "信息来源",
      evidenceText: "Moreno said",
      explanationZh: "报道明确将说法归于莫雷诺，未把推测当作事实。",
    },
  ];
  if (!headline)
    analysis.result.sentences.push({
      ...sentence,
      ordinal: 1,
      analysisUnitId: "u2",
      candidateIds: [],
      sourceText: "The flames then spread in a wooded area around Los Gallardos, Almería.",
      translationZh: "火焰随后蔓延至阿尔梅里亚洛斯加亚尔多斯附近的林区。",
      structure: [],
      grammar: [],
      languageNotes: [],
      expressions: [
        { label: "林区", evidenceText: "a wooded area", explanationZh: "指树木覆盖的区域。" },
      ],
    });
  if (headline) {
    sentence.structure = [
      {
        label: "结果补足语",
        evidenceText: "leaves at least 12 dead and 23 missing",
        explanationZh: "leave 后的人数与状态说明野火造成的结果。",
      },
    ];
    sentence.grammar = [];
    sentence.expressions = [
      { label: "至少", evidenceText: "at least", explanationZh: "表示报道确认的最低数量。" },
    ];
    sentence.languageNotes = [];
  }
  return analysisRecordSchema.parse(analysis);
}

for (const width of [390, 1440]) {
  for (const theme of ["moon", "silver", "champagne", "porcelain"]) {
    test(`reading hierarchy ${theme} at ${width}`, async ({ page }, testInfo) => {
      const authority = createCloudBrowserAuthority({
        authenticated: true,
        seed: "candidate-analysis",
      });
      await authority.install(page);
      const analysis = readingRecord();
      await page.route("https://api.huayi.invalid/v1/analyses**", async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        const list = new URL(route.request().url()).pathname === "/v1/analyses";
        await route.fulfill({
          status: 200,
          headers: cloudCors("https://web.huayi.invalid") ?? {},
          json: list ? { items: [analysis], nextCursor: null } : analysis,
        });
      });
      await page.addInitScript(
        (value) => localStorage.setItem("huayi.web.appearance.v1", value),
        theme,
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("https://web.huayi.invalid/app");
      const reading = page.getByRole("region", { name: "原文解析" });
      await expect(reading.getByText(translation, { exact: true })).toBeVisible();
      await expect(reading.getByText(understanding, { exact: true })).not.toBeVisible();
      const context = reading.getByText("理解与语境补充", { exact: true });
      await context.focus();
      await page.keyboard.press("Enter");
      await expect(reading.getByText(understanding, { exact: true })).toBeVisible();
      await expect(reading.getByText(/新闻报道采用审慎语气/u)).toBeVisible();
      await page.keyboard.press("Enter");
      const summary = reading.locator(".analysis-reading-sentence > summary").first();
      await expect(summary).toContainText("01");
      await expect(summary).toContainText(firstSentence);
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(summary).toContainText("收起解析");
      await expect(reading.getByText("to have been caused", { exact: true })).toBeVisible();
      await expect(reading.getByText("生成示例", { exact: true })).toBeVisible();
      await expect(reading.getByText("易错提醒", { exact: true })).toBeVisible();
      const style = await reading
        .locator(".analysis-teaching-evidence")
        .first()
        .evaluate((node) => {
          const css = getComputedStyle(node);
          return { border: css.borderLeftWidth, weight: css.fontWeight };
        });
      expect(style).toEqual({ border: "3px", weight: "600" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      await summary.evaluate((node) => (node as HTMLElement).blur());
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`reading-${theme}-${width}.png`),
      });
      await summary.focus();
      await page.keyboard.press("Space");
      await expect(reading.getByText("to have been caused", { exact: true })).not.toBeVisible();
      expect(authority.snapshot().requestFacts.filter((fact) => fact.method === "POST")).toEqual(
        [],
      );
    });
  }
}

test("headline shows a single primary Chinese version", async ({ page }) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "candidate-analysis",
  });
  await authority.install(page);
  const analysis = readingRecord(true);
  await page.route("https://api.huayi.invalid/v1/analyses**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: cloudCors("https://web.huayi.invalid") ?? {},
      json:
        new URL(route.request().url()).pathname === "/v1/analyses"
          ? { items: [analysis], nextCursor: null }
          : analysis,
    });
  });
  await page.goto("https://web.huayi.invalid/app");
  const reading = page.getByRole("region", { name: "原文解析" });
  await expect(
    reading.getByText("西班牙南部的一场野火已造成至少12人死亡、23人失踪。", { exact: true }),
  ).toBeVisible();
  await expect(
    reading.getByText("这条新闻说，西班牙南部的一场野火已导致至少12人死亡、23人失踪。", {
      exact: true,
    }),
  ).not.toBeVisible();
});

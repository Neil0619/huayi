import { z } from "zod/v3";
import {
  extensionQueryGenerationRequestSchema,
  segmentSentenceSource,
} from "@huayi/cloud-contracts";

const marker = "【本机模拟】";
const inputSchema = z.strictObject({
  selectionKind: z.enum(["phrase", "sentence", "passage"]),
  units: z.array(z.string().min(1).max(2000).regex(/\S/u)).min(1).max(40),
  learnerContext: z.string().min(1).max(1000).optional(),
});
function structure(text: string) {
  const fragments = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 500, text.length);
    const last = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
    const fragment = text.slice(start, end);
    let occurrence = 1,
      at = text.indexOf(fragment);
    while (at < start && at !== -1) {
      occurrence += 1;
      at = text.indexOf(fragment, at + 1);
    }
    fragments.push({ text: fragment, occurrence });
    start = end;
  }
  return {
    kind: "fragment",
    coreClauses: [
      {
        fragments,
        explanationZh: `${marker}固定片段用于验证结构展示，不代表语法分析。`,
      },
    ],
    modifiers: [],
  };
}
function candidates(source: string) {
  const text = source.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/u)?.[0];
  if (text === undefined) return [];
  return [
    {
      type: "expression",
      text,
      meaningZh: `${marker}固定示例含义。`,
      usageZh: `${marker}仅用于流程验收。`,
      learningAdvice: {
        priority: 1,
        sourceRefs: [{ text, occurrence: 1 }],
        useWhenZh: `${marker}用于演示选择学习项的步骤。`,
        reasonZh: `${marker}固定候选，不代表真实推荐。`,
        generatedExample: {
          sourceText: `"${text}" appears in this example.`,
          translationZh: `${marker}这个例句包含所选表达。`,
        },
      },
    },
  ];
}
export function simulatedStructuredAnalysis(rawInput: unknown) {
  const input = inputSchema.parse(rawInput);
  const previewZh = `${marker}正在展示固定结构与学习建议。`;
  if (input.selectionKind === "phrase")
    return {
      previewZh,
      result: {
        candidates: candidates(input.units[0] ?? ""),
        contextualMeaningZh: `${marker}固定语境含义。`,
        register: "neutral",
        structureAndCollocationZh: [`${marker}固定结构说明。`],
        translationZh: `${marker}固定翻译。`,
        usageNotes: [],
      },
    };
  return {
    previewZh,
    result: {
      overall: { translationZh: `${marker}固定翻译。`, understandingZh: `${marker}固定整体理解。` },
      sentences: input.units.map((unit, index) => ({
        sentenceStructure: structure(unit),
        candidates: index === 0 ? candidates(unit) : [],
        translationZh: `${marker}固定单元翻译。`,
        grammar: [],
        expressions: [],
        languageNotes: [],
      })),
    },
  };
}
export function simulatedStructuredQuery(rawInput: unknown) {
  const { units, ...value } = z.record(z.unknown()).parse(rawInput);
  const input = extensionQueryGenerationRequestSchema.parse(value);
  const expected = segmentSentenceSource(input.sourceText).map((unit) => unit.sourceText);
  if (
    !("outputContract" in input) ||
    input.action !== "explain" ||
    (input.selectionKind !== "sentence" && input.selectionKind !== "passage") ||
    JSON.stringify(units) !== JSON.stringify(expected)
  )
    throw new Error("Invalid simulated native query.");
  const text = input.sourceText.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/u)?.[0];
  if (text === undefined) throw new Error("No English expression for simulated query.");
  return {
    contextRole: `${marker}固定语境作用。`,
    keyExpressions: [{ text, meaningZh: `${marker}固定表达含义。` }],
    translationZh: `${marker}固定翻译。`,
    sentenceStructures: expected.map(structure),
  };
}

import { useState } from "react";
import { Text, View } from "@tarojs/components";
import type { AnalysisRecord } from "@huayi/cloud-contracts";
import { Action, Card, Paragraph } from "./ui";

type Point = Extract<
  AnalysisRecord["result"],
  { type: "phrase-analysis-v2" }
>["usageNotes"][number];
function Points({ title, points }: { title: string; points: Point[] }) {
  if (!points.length) return null;
  const seen = new Set<string>();
  return (
    <View>
      <Text className="field-label">{title}</Text>
      {points
        .filter((point) => {
          if (seen.has(point.explanationZh)) return false;
          seen.add(point.explanationZh);
          return true;
        })
        .map((point, index) => (
          <View key={`${point.label}-${index}`}>
            <Text className="pill">{point.label}</Text>
            {point.evidenceText && <Paragraph>{point.evidenceText}</Paragraph>}
            <Paragraph>{point.explanationZh}</Paragraph>
            {point.commonMistakeZh && <Paragraph>易错点：{point.commonMistakeZh}</Paragraph>}
            {point.generatedExample && (
              <>
                <Paragraph>{point.generatedExample.sourceText}</Paragraph>
                <Paragraph>{point.generatedExample.translationZh}</Paragraph>
              </>
            )}
          </View>
        ))}
    </View>
  );
}
export function AnalysisBody({ record }: { record: AnalysisRecord }) {
  const [open, setOpen] = useState<string[]>(["u1"]);
  const result = record.result;
  if (result.type === "phrase-analysis-v2")
    return (
      <Card title="理解与用法">
        <Paragraph>{result.translationZh}</Paragraph>
        {result.contextualMeaningZh !== result.translationZh && (
          <Paragraph>{result.contextualMeaningZh}</Paragraph>
        )}
        {result.register && <Text className="pill">{result.register}</Text>}
        {result.structureAndCollocationZh.map((text) => (
          <Paragraph key={text}>{text}</Paragraph>
        ))}
        <Points title="用法与易错点" points={result.usageNotes} />
      </Card>
    );
  return (
    <>
      <Card title="整体理解">
        <Paragraph>{result.overall.translationZh}</Paragraph>
        {result.overall.understandingZh !== result.overall.translationZh && (
          <Paragraph>{result.overall.understandingZh}</Paragraph>
        )}
        {result.overall.contextAndToneZh && (
          <Paragraph>{result.overall.contextAndToneZh}</Paragraph>
        )}
      </Card>
      {result.sentences.map((sentence) => (
        <Card key={sentence.analysisUnitId} title={`第 ${sentence.ordinal + 1} 句`}>
          <Text className="source" userSelect>
            {sentence.sourceText}
          </Text>
          <Paragraph>{sentence.translationZh}</Paragraph>
          <Action
            secondary
            onClick={() =>
              setOpen((values) =>
                values.includes(sentence.analysisUnitId)
                  ? values.filter((id) => id !== sentence.analysisUnitId)
                  : [...values, sentence.analysisUnitId],
              )
            }
          >
            {open.includes(sentence.analysisUnitId) ? "收起讲解" : "展开句子主干与讲解"}
          </Action>
          {open.includes(sentence.analysisUnitId) && (
            <>
              <Points title="句子主干" points={sentence.structure} />
              <Points title="关键表达" points={sentence.expressions} />
              <Points title="语法与易错点" points={sentence.grammar} />
              <Points title="补充说明" points={sentence.languageNotes} />
            </>
          )}
        </Card>
      ))}
    </>
  );
}

import type { AnalysisRecord } from "@huayi/cloud-contracts";

import { DeepAnalysisTeaching } from "./deep-analysis-teaching.js";

function ReadingContext({
  understanding,
  tone,
}: {
  understanding: string;
  tone: string | undefined;
}) {
  if (!understanding && !tone) return null;
  return (
    <details className="analysis-reading-context">
      <summary>理解与语境补充</summary>
      <div>
        {understanding && <p>{understanding}</p>}
        {tone && (
          <p>
            <strong>语境与语气</strong> · {tone}
          </p>
        )}
      </div>
    </details>
  );
}

export function DeepAnalysisReading({ analysis }: { analysis: AnalysisRecord }) {
  const result = analysis.result;
  return (
    <section className="deep-analysis-reading" aria-label="原文解析">
      <header className="analysis-reading-overview">
        <h3>自然译文</h3>
        <p className="analysis-reading-translation">
          {result.type === "phrase-analysis-v2"
            ? result.translationZh
            : result.overall.translationZh}
        </p>
        <ReadingContext
          understanding={
            result.type === "phrase-analysis-v2"
              ? result.contextualMeaningZh
              : result.overall.understandingZh
          }
          tone={result.type === "phrase-analysis-v2" ? undefined : result.overall.contextAndToneZh}
        />
      </header>
      {result.type === "phrase-analysis-v2" ? (
        <div className="analysis-reading-groups">
          {result.structureAndCollocationZh.length > 0 && (
            <section className="analysis-teaching-group">
              <h4>结构与搭配</h4>
              <div className="analysis-teaching-points">
                {result.structureAndCollocationZh.map((text, index) => (
                  <p key={index}>{text}</p>
                ))}
              </div>
            </section>
          )}
          {result.register && (
            <section className="analysis-teaching-group">
              <h4>语域</h4>
              <p>{result.register}</p>
            </section>
          )}
          <DeepAnalysisTeaching
            title="使用提醒"
            points={result.usageNotes}
            sourceText={analysis.sourceText}
          />
        </div>
      ) : (
        <section className="analysis-reading-sentences" aria-label="逐句解析">
          <h3>逐句解析</h3>
          {result.sentences.map((sentence, index) => (
            <details className="analysis-reading-sentence" key={sentence.analysisUnitId}>
              <summary>
                <span className="analysis-reading-number" aria-label={`第 ${index + 1} 句`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="analysis-reading-source" lang="en">
                  {sentence.sourceText}
                </span>
                <span className="analysis-reading-toggle">
                  <span className="analysis-reading-expand">展开解析</span>
                  <span className="analysis-reading-collapse">收起解析</span>
                  <span aria-hidden="true">⌄</span>
                </span>
              </summary>
              <div className="analysis-reading-sentence-body">
                <p className="analysis-reading-sentence-translation">
                  <span>本句译文</span>
                  {sentence.translationZh}
                </p>
                <div className="analysis-reading-groups">
                  <DeepAnalysisTeaching
                    title="结构"
                    points={sentence.structure}
                    sourceText={sentence.sourceText}
                  />
                  <DeepAnalysisTeaching
                    title="语法"
                    points={sentence.grammar}
                    sourceText={sentence.sourceText}
                  />
                  <DeepAnalysisTeaching
                    title="表达"
                    points={sentence.expressions}
                    sourceText={sentence.sourceText}
                  />
                  <DeepAnalysisTeaching
                    title="使用提醒"
                    points={sentence.languageNotes}
                    sourceText={sentence.sourceText}
                  />
                </div>
              </div>
            </details>
          ))}
        </section>
      )}
    </section>
  );
}

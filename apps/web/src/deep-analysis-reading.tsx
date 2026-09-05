import type { AnalysisRecord } from "@huayi/cloud-contracts";
export function DeepAnalysisReading({ analysis }: { analysis: AnalysisRecord }) {
  const result = analysis.result;
  return (
    <section className="analysis-reading">
      <h3>理解原文</h3>
      {result.type === "phrase-analysis-v2" ? (
        <>
          <p>{result.contextualMeaningZh}</p>
          <p>{result.translationZh}</p>
          {result.structureAndCollocationZh.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </>
      ) : (
        <>
          <p>{result.overall.understandingZh}</p>
          <p>{result.overall.translationZh}</p>
          {result.sentences.map((sentence) => (
            <details key={sentence.analysisUnitId}>
              <summary>{sentence.sourceText}</summary>
              <p>{sentence.translationZh}</p>
              {(
                [
                  ["结构", sentence.structure],
                  ["语法", sentence.grammar],
                  ["表达", sentence.expressions],
                  ["使用提醒", sentence.languageNotes],
                ] as const
              ).map(
                ([label, points]) =>
                  points.length > 0 && (
                    <section key={label}>
                      <h4>{label}</h4>
                      {points.map((point, index) => (
                        <article key={index}>
                          <strong>{point.label}</strong>
                          <p>{point.explanationZh}</p>
                          {point.commonMistakeZh && <p>常见问题：{point.commonMistakeZh}</p>}
                          {point.generatedExample && (
                            <blockquote>
                              {point.generatedExample.sourceText}
                              <br />
                              {point.generatedExample.translationZh}
                            </blockquote>
                          )}
                        </article>
                      ))}
                    </section>
                  ),
              )}
            </details>
          ))}
        </>
      )}
    </section>
  );
}

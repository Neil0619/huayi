import type { AnalysisRecord } from "@huayi/cloud-contracts";

type PhraseResult = Extract<AnalysisRecord["result"], { type: "phrase-analysis-v2" }>;
type TeachingPoint = PhraseResult["usageNotes"][number];

export function DeepAnalysisTeaching({
  title,
  points,
  sourceText,
}: {
  title: string;
  points: TeachingPoint[];
  sourceText: string;
}) {
  if (points.length === 0) return null;
  return (
    <section className="analysis-teaching-group">
      <h4>{title}</h4>
      <div className="analysis-teaching-points">
        {points.map((point, index) => {
          const evidence =
            point.evidenceText && sourceText.includes(point.evidenceText)
              ? point.evidenceText
              : undefined;
          const titleIsEvidence = evidence === point.label;
          return (
            <article className="analysis-teaching-point" key={index}>
              <h5
                className={titleIsEvidence ? "analysis-teaching-evidence" : undefined}
                lang={titleIsEvidence ? "en" : undefined}
              >
                {point.label}
              </h5>
              {evidence && !titleIsEvidence && (
                <blockquote className="analysis-teaching-evidence" lang="en">
                  {evidence}
                </blockquote>
              )}
              <p>{point.explanationZh}</p>
              {point.commonMistakeZh && (
                <aside className="analysis-teaching-pitfall">
                  <strong>易错提醒</strong>
                  <p>{point.commonMistakeZh}</p>
                </aside>
              )}
              {point.generatedExample && (
                <figure className="analysis-teaching-example">
                  <figcaption>生成示例</figcaption>
                  <p lang="en">{point.generatedExample.sourceText}</p>
                  <p className="analysis-reading-secondary">
                    {point.generatedExample.translationZh}
                  </p>
                </figure>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

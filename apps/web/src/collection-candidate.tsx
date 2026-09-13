import { useState } from "react";
import type { LearningRecommendation } from "@huayi/cloud-contracts";
import { CandidateEditor, type CandidateDraft } from "./candidate-editor.js";
export function CollectionCandidate({
  draft,
  index,
  onChange,
  recommendation,
}: {
  recommendation?: LearningRecommendation;
  draft: CandidateDraft;
  index: number;
  onChange(draft: CandidateDraft): void;
}) {
  const [adviceOpen, setAdviceOpen] = useState(true);
  const content = draft.candidate.payload;
  const text = content.type === "expression" ? content.text : content.template;
  const meaning = content.type === "expression" ? content.meaningZh : content.functionZh;
  return (
    <article
      className="collection-candidate"
      data-candidate-id={draft.candidate.id}
      data-recommendation={recommendation ? "true" : undefined}
    >
      <label className="collection-candidate-choice">
        <input
          type="checkbox"
          data-candidate-selected
          checked={draft.selected}
          onChange={(event) => onChange({ ...draft, selected: event.currentTarget.checked })}
        />
        <span>
          <strong>{text}</strong>
          <small>{meaning}</small>
        </span>
      </label>
      {recommendation && (
        <details
          data-recommendation-advice
          open={adviceOpen}
          onToggle={(event) => setAdviceOpen(event.currentTarget.open)}
        >
          <summary>适用场景与推荐理由</summary>
          <p>{recommendation.useWhenZh}</p>
          <p>{recommendation.reasonZh}</p>
          <section className="recommendation-evidence">
            <h5>原文依据</h5>
            <p className="field-help">以下引用对应分析时的原始候选。</p>
            {recommendation.sourceEvidence.map((span) => (
              <blockquote key={`${span.start}-${span.end}`} lang="en">
                {span.text}
              </blockquote>
            ))}
          </section>
          <section className="analysis-teaching-example">
            <h5>生成示例</h5>
            <p lang="en">{recommendation.generatedExample.sourceText}</p>
            <p>{recommendation.generatedExample.translationZh}</p>
          </section>
        </details>
      )}
      <details>
        <summary>编辑内容与标签</summary>
        <CandidateEditor draft={draft} index={index} onChange={onChange} />
      </details>
    </article>
  );
}

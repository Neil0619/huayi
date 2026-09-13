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
  const [adviceOpen, setAdviceOpen] = useState(false);
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
        <section className="analysis-teaching-example">
          <h5>生成示例</h5>
          <p lang="en">{recommendation.generatedExample.sourceText}</p>
          <p>{recommendation.generatedExample.translationZh}</p>
        </section>
      )}
      {recommendation && (
        <details
          data-recommendation-advice
          open={adviceOpen}
          onToggle={(event) => setAdviceOpen(event.currentTarget.open)}
        >
          <summary>适用场景与推荐理由</summary>
          <p>{recommendation.useWhenZh}</p>
          <p>{recommendation.reasonZh}</p>
        </details>
      )}
      <details>
        <summary>编辑内容与标签</summary>
        <CandidateEditor draft={draft} index={index} onChange={onChange} />
      </details>
    </article>
  );
}

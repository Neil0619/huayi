import type { AnalysisRecordRead } from "@huayi/cloud-contracts";
import { CollectionCandidate } from "./collection-candidate.js";
import type { CandidateDraft } from "./candidate-editor.js";

export function CandidateChoices({
  analysis,
  drafts,
  onChange,
}: {
  analysis: AnalysisRecordRead;
  drafts: CandidateDraft[];
  onChange(draft: CandidateDraft): void;
}) {
  const recommendations =
    "recommendations" in analysis.result ? analysis.result.recommendations : [];
  const suggested = new Set(recommendations.map((value) => value.candidateId));
  const remaining = drafts.filter((draft) => !suggested.has(draft.candidate.id));
  const render = (draft: CandidateDraft, recommendation?: (typeof recommendations)[number]) => (
    <CollectionCandidate
      key={draft.candidate.id}
      draft={draft}
      index={analysis.candidates.findIndex((candidate) => candidate.id === draft.candidate.id)}
      onChange={onChange}
      {...(recommendation ? { recommendation } : {})}
    />
  );
  return (
    <>
      {recommendations.length > 0 && (
        <section aria-label="推荐学习内容">
          <h4>优先推荐</h4>
          {recommendations.map((recommendation) => {
            const draft = drafts.find((value) => value.candidate.id === recommendation.candidateId);
            return draft ? render(draft, recommendation) : null;
          })}
        </section>
      )}
      {remaining.length > 0 && (
        <details data-remaining-candidates>
          <summary>
            {recommendations.length ? "其他候选" : "全部候选"}（{remaining.length}）
          </summary>
          {remaining.map((draft) => render(draft))}
        </details>
      )}
    </>
  );
}

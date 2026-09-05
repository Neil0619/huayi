import { CollectionCandidate } from "./collection-candidate.js";
import { useEffect, useRef, useState } from "react";
import type { AnalysisRecord } from "@huayi/cloud-contracts";
import type { InboxApi } from "./inbox-app.js";
import {
  confirmationForDraft,
  initialCandidateDrafts,
  type CandidateDraft,
} from "./candidate-editor.js";
import { DeepAnalysisReading } from "./deep-analysis-reading.js";
export function CollectionReview({
  analysis,
  api,
  idempotencyKey,
  onSaved,
  onContinue,
  draftCache,
}: {
  draftCache: Map<string, CandidateDraft[]>;
  analysis: AnalysisRecord;
  api: InboxApi;
  idempotencyKey(): string;
  onSaved(analysis: AnalysisRecord): void;
  onContinue(): void;
}) {
  const [drafts, setDrafts] = useState<CandidateDraft[]>(
    () => draftCache.get(analysis.id) ?? initialCandidateDrafts(analysis),
  );
  const mutation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedIds, setSavedIds] = useState<string[]>([]);
  useEffect(() => {
    setDrafts(draftCache.get(analysis.id) ?? initialCandidateDrafts(analysis));
    setSavedIds([]);
    setError("");
  }, [analysis.id]);
  const confirm = async () => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      const selected = drafts.filter((draft) => draft.selected);
      if (!selected.length) {
        setError("请勾选至少一个想练习的表达或句型。");
        return;
      }
      const response = await api.confirmCandidates(
        analysis.id,
        { analysisRevision: analysis.revision, confirmations: selected.map(confirmationForDraft) },
        idempotencyKey(),
      );
      setSavedIds(response.results.map((result) => result.item.id));
      onSaved(response.analysis);
    } catch {
      setError("保存未完成，当前选择和编辑已保留。请检查是否已有相同学习项后重试。");
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="collection-review">
      <DeepAnalysisReading analysis={analysis} />
      {error && <p role="alert">{error}</p>}
      {analysis.reviewState === "reviewed" ? (
        <section className="collection-completed">
          <h3>已整理到学习库</h3>
          <p>接下来可以立即练习，也可以继续整理其他原文。</p>
          <a
            className="primary"
            href={savedIds[0] ? `/practice?item=${encodeURIComponent(savedIds[0])}` : "/practice"}
          >
            立即练习
          </a>
          <button onClick={onContinue} type="button">
            继续整理
          </button>
        </section>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <h3>选择你想学会使用的表达与句型</h3>
          <p>勾选并加入学习库后，就可以造句或对话。</p>
          {drafts.map((draft, index) => (
            <CollectionCandidate
              key={draft.candidate.id}
              draft={draft}
              index={index}
              onChange={(next) =>
                setDrafts((values) => {
                  const edited = values.map((value, position) =>
                    position === index ? next : value,
                  );
                  draftCache.set(analysis.id, edited);
                  return edited;
                })
              }
            />
          ))}
          <div className="form-actions">
            <button disabled={busy || !drafts.some((draft) => draft.selected)} type="submit">
              加入学习库
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api
                  .processNothingToSave(analysis.id, analysis.revision, idempotencyKey())
                  .then(onSaved)
                  .catch(() => setError("更新未完成，请重试。"))
                  .finally(() => setBusy(false));
              }}
              type="button"
            >
              这条无需学习
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

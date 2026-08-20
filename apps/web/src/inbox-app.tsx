import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  type AnalysisRecord,
  type ConfirmCandidatesRequest,
  type ConfirmCandidatesResponse,
} from "@huayi/cloud-contracts";

import {
  CandidateEditor,
  confirmationForDraft,
  initialCandidateDrafts,
  type CandidateDraft,
} from "./candidate-editor.js";

export interface InboxApi {
  confirmCandidates(
    id: string,
    input: ConfirmCandidatesRequest,
    idempotencyKey: string,
  ): Promise<ConfirmCandidatesResponse>;
  getAnalysis(id: string): Promise<AnalysisRecord>;
  listPending(): Promise<{ items: AnalysisRecord[]; nextCursor: string | null }>;
  processNothingToSave(
    id: string,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<AnalysisRecord>;
}

interface InboxAppProps {
  readonly api: InboxApi;
  readonly createIdempotencyKey?: () => string;
}

type LoadState = "empty" | "error" | "loading" | "ready";

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export function InboxApp({ api, createIdempotencyKey = () => crypto.randomUUID() }: InboxAppProps) {
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [detail, setDetail] = useState<AnalysisRecord | null>(null);
  const [drafts, setDrafts] = useState<CandidateDraft[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);

  const openAnalysis = useCallback(
    async (analysis: AnalysisRecord) => {
      setDetailLoading(true);
      setError(null);
      try {
        const loaded = await api.getAnalysis(analysis.id);
        setDetail(loaded);
        setDrafts(initialCandidateDrafts(loaded));
      } catch {
        setError("暂时无法载入这条分析，请重试。");
      } finally {
        setDetailLoading(false);
      }
    },
    [api],
  );

  const loadInbox = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const response = await api.listPending();
      setAnalyses(response.items);
      setLoadState(response.items.length === 0 ? "empty" : "ready");
      if (response.items[0] !== undefined) await openAnalysis(response.items[0]);
    } catch {
      setLoadState("error");
      setError("暂时无法载入待整理内容，请检查网络后重试。");
    }
  }, [api, openAnalysis]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const removeCurrent = async () => {
    if (detail === null) return;
    const remaining = analyses.filter((analysis) => analysis.id !== detail.id);
    setAnalyses(remaining);
    setDetail(null);
    setDrafts([]);
    setLoadState(remaining.length === 0 ? "empty" : "ready");
    listHeading.current?.focus();
    if (remaining[0] !== undefined) await openAnalysis(remaining[0]);
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (detail === null) return;
    const selected = drafts.filter((draft) => draft.selected);
    if (selected.length === 0) {
      setError("请至少选择一个候选项。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api.confirmCandidates(
        detail.id,
        {
          analysisRevision: detail.revision,
          confirmations: selected.map(confirmationForDraft),
        },
        createIdempotencyKey(),
      );
      setStatus(`已整理 ${response.results.length} 项。`);
      await removeCurrent();
    } catch (caught) {
      setError(
        errorCode(caught) === "exact_duplicate"
          ? "已有完全相同的学习项。系统保留了当前编辑与选择；精确查重入口接通后，请显式选择合并目标。"
          : "整理提交失败，当前编辑与选择已保留，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  };

  const markNothing = async () => {
    if (detail === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.processNothingToSave(detail.id, detail.revision, createIdempotencyKey());
      setStatus("已标记为无需收藏。");
      await removeCurrent();
    } catch {
      setError("暂时无法更新这条分析，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">INBOX</p>
          <h1>待整理</h1>
        </div>
        <p>把分析候选编辑成你真正想复用的表达与句型。</p>
      </header>
      {status !== null && (
        <p aria-live="polite" role="status">
          {status}
        </p>
      )}
      {error !== null && (
        <div className="alert" role="alert">
          <p>{error}</p>
          {loadState === "error" && (
            <button data-retry-inbox onClick={() => void loadInbox()} type="button">
              重新载入
            </button>
          )}
        </div>
      )}
      {loadState === "loading" && (
        <p aria-live="polite" role="status">
          正在载入待整理内容…
        </p>
      )}
      {loadState === "empty" && (
        <section className="empty-state">
          <h2>待整理箱已经清空</h2>
          <p>新的完整分析会出现在这里。</p>
        </section>
      )}
      {loadState === "ready" && (
        <div className="inbox-layout">
          <aside aria-label="待整理分析" className="analysis-list">
            <h2 data-analysis-list-heading ref={listHeading} tabIndex={-1}>
              待处理 {analyses.length}
            </h2>
            {analyses.map((analysis) => (
              <button
                aria-pressed={detail?.id === analysis.id}
                key={analysis.id}
                onClick={() => void openAnalysis(analysis)}
                type="button"
              >
                <strong>{analysis.source.title ?? "未命名来源"}</strong>
                <span>{analysis.sourceText}</span>
              </button>
            ))}
          </aside>
          <section aria-busy={detailLoading} className="analysis-detail">
            {detailLoading && <p role="status">正在载入分析详情…</p>}
            {!detailLoading && detail !== null && (
              <>
                <header>
                  <p>{detail.source.type}</p>
                  <h2>{detail.sourceText}</h2>
                </header>
                {"overall" in detail.result && (
                  <div className="analysis-summary">
                    <p>{detail.result.overall.understandingZh}</p>
                    <p>{detail.result.overall.translationZh}</p>
                  </div>
                )}
                <form data-candidate-form onSubmit={(event) => void confirm(event)}>
                  {drafts.map((draft, index) => (
                    <CandidateEditor
                      draft={draft}
                      index={index}
                      key={draft.candidate.id}
                      onChange={(next) =>
                        setDrafts((current) =>
                          current.map((item, itemIndex) => (itemIndex === index ? next : item)),
                        )
                      }
                    />
                  ))}
                  <div className="form-actions">
                    <button disabled={busy} type="submit">
                      确认所选候选
                    </button>
                    <button
                      data-nothing-to-save
                      disabled={busy}
                      onClick={() => void markNothing()}
                      type="button"
                    >
                      无需收藏
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

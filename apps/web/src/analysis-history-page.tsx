import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { AnalysisRecord } from "@huayi/cloud-contracts";

import { AnalysisHistoryActions } from "./analysis-history-actions.js";
import { AnalysisHistoryDetail } from "./analysis-history-detail.js";
import {
  initialAnalysisHistoryFilters,
  toAnalysisHistoryQuery,
  type AnalysisHistoryFilters,
} from "./analysis-history-filters.js";
import type { AnalysisHistoryPageApi } from "./analysis-history-page-api.js";
import { PracticeShell } from "./practice-shell.js";

type LoadState = "empty" | "error" | "loading" | "ready";

export function AnalysisHistoryPage({
  api,
  idempotencyKey = () => crypto.randomUUID(),
}: {
  readonly api: AnalysisHistoryPageApi;
  readonly idempotencyKey?: (() => string) | undefined;
}) {
  const [activeFilters, setActiveFilters] = useState(initialAnalysisHistoryFilters);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteStudyCapture, setDeleteStudyCapture] = useState(true);
  const [detail, setDetail] = useState<AnalysisRecord | null>(null);
  const [draftFilters, setDraftFilters] = useState(initialAnalysisHistoryFilters);
  const [error, setError] = useState("");
  const [items, setItems] = useState<AnalysisRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const actionGeneration = useRef(0);
  const actionBusyRef = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const detailGeneration = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const listGeneration = useRef(0);

  const query = useCallback(
    (cursor?: string) => toAnalysisHistoryQuery(activeFilters, cursor),
    [activeFilters],
  );

  const load = useCallback(
    async (cursor?: string, preserveDetail = false, keepReadyWhenEmpty = false) => {
      const generation = ++listGeneration.current;
      if (cursor === undefined && !preserveDetail) setLoadState("loading");
      setError("");
      try {
        const response = await api.listHistory(query(cursor));
        if (generation !== listGeneration.current) return false;
        setItems((current) => {
          if (cursor === undefined) return response.items;
          const ids = new Set(current.map(({ id }) => id));
          return [...current, ...response.items.filter(({ id }) => !ids.has(id))];
        });
        setNextCursor(response.nextCursor);
        if (cursor === undefined && !preserveDetail) {
          detailGeneration.current += 1;
          actionGeneration.current += 1;
          actionBusyRef.current = false;
          setActionBusy(false);
          setDetail(null);
          setLoadState(response.items.length === 0 ? "empty" : "ready");
        } else if (cursor === undefined) {
          setLoadState(response.items.length === 0 && !keepReadyWhenEmpty ? "empty" : "ready");
        }
        return true;
      } catch {
        if (generation !== listGeneration.current) return false;
        setError("暂时无法载入分析历史，请稍后重试。");
        if (cursor === undefined && !preserveDetail) setLoadState("error");
        return false;
      }
    },
    [api, query],
  );

  useEffect(() => void load(), [load]);
  useEffect(
    () => () => {
      listGeneration.current += 1;
      detailGeneration.current += 1;
      actionGeneration.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (detail !== null) detailHeading.current?.focus();
  }, [detail]);
  useEffect(() => {
    if (confirmingDelete) confirmButton.current?.focus();
  }, [confirmingDelete]);

  const open = async (id: string) => {
    const generation = ++detailGeneration.current;
    actionGeneration.current += 1;
    actionBusyRef.current = false;
    setActionBusy(false);
    setError("");
    setConfirmingDelete(false);
    setDeleteStudyCapture(true);
    try {
      const record = await api.getAnalysis(id);
      if (generation === detailGeneration.current) setDetail(record);
    } catch {
      if (generation === detailGeneration.current) setError("暂时无法读取这条分析记录。");
    }
  };

  const refreshAfter = async (record: AnalysisRecord, label: string, generation: number) => {
    setDetail(record);
    setStatus(`${label}已完成。`);
    const listOk = await load(undefined, true, true);
    if (generation !== actionGeneration.current) return;
    try {
      const fresh = await api.getAnalysis(record.id);
      if (generation !== actionGeneration.current) return;
      setDetail(fresh);
      if (!listOk) setStatus(`${label}已完成，但列表刷新失败。`);
    } catch {
      if (generation === actionGeneration.current) setStatus(`${label}已完成，但刷新失败。`);
    }
  };

  const mutate = async (
    label: string,
    operation: (record: AnalysisRecord) => Promise<AnalysisRecord>,
  ) => {
    if (detail === null || actionBusyRef.current) return;
    actionBusyRef.current = true;
    setActionBusy(true);
    const generation = ++actionGeneration.current;
    setError("");
    try {
      const record = await operation(detail);
      if (generation === actionGeneration.current) await refreshAfter(record, label, generation);
    } catch {
      if (generation === actionGeneration.current)
        setError("操作失败，当前详情已保留，请刷新后重试。");
    } finally {
      if (generation === actionGeneration.current) {
        actionBusyRef.current = false;
        setActionBusy(false);
      }
    }
  };

  const remove = async () => {
    if (detail === null || actionBusyRef.current) return;
    actionBusyRef.current = true;
    setActionBusy(true);
    const generation = ++actionGeneration.current;
    setError("");
    try {
      await api.deleteAnalysis(
        detail.id,
        detail.revision,
        idempotencyKey(),
        detail.studyCaptureId === undefined ? false : deleteStudyCapture,
      );
      if (generation !== actionGeneration.current) return;
      detailGeneration.current += 1;
      setDetail(null);
      setConfirmingDelete(false);
      setStatus("删除已完成。");
      if (!(await load(undefined, true)) && generation === actionGeneration.current) {
        setStatus("删除已完成，但列表刷新失败。");
      }
    } catch {
      if (generation === actionGeneration.current) setError("删除操作失败，当前详情已保留。");
    } finally {
      if (generation === actionGeneration.current) {
        actionBusyRef.current = false;
        setActionBusy(false);
      }
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setActiveFilters({ ...draftFilters, query: draftFilters.query.trim() });
  };

  return (
    <PracticeShell current="分析历史">
      <div className="analysis-history-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">ANALYSIS HISTORY</p>
            <h1>分析历史</h1>
          </div>
          <p>归档与整理状态彼此独立；这里不重新编辑候选。</p>
        </header>
        <form className="analysis-history-filters" onSubmit={submit}>
          <label>
            搜索
            <input
              maxLength={200}
              name="query"
              onChange={(event) => {
                const query = event.currentTarget.value;
                setDraftFilters((value) => ({ ...value, query }));
              }}
              value={draftFilters.query}
            />
          </label>
          <label>
            归档
            <select
              name="archived"
              onChange={(event) => {
                const archived = event.currentTarget.value === "true";
                setDraftFilters((value) => ({ ...value, archived }));
              }}
              value={String(draftFilters.archived)}
            >
              <option value="false">未归档</option>
              <option value="true">已归档</option>
            </select>
          </label>
          <label>
            整理状态
            <select
              name="reviewState"
              onChange={(event) => {
                const reviewState = event.currentTarget
                  .value as AnalysisHistoryFilters["reviewState"];
                setDraftFilters((value) => ({ ...value, reviewState }));
              }}
              value={draftFilters.reviewState}
            >
              <option value="">全部</option>
              <option value="pendingReview">待整理</option>
              <option value="reviewed">已整理</option>
            </select>
          </label>
          <label>
            来源
            <select
              name="sourceType"
              onChange={(event) => {
                const sourceType = event.currentTarget
                  .value as AnalysisHistoryFilters["sourceType"];
                setDraftFilters((value) => ({ ...value, sourceType }));
              }}
              value={draftFilters.sourceType}
            >
              <option value="">全部</option>
              <option value="manual">手动</option>
              <option value="study-capture">待学习采集</option>
            </select>
          </label>
          <label>
            选区
            <select
              name="selectionKind"
              onChange={(event) => {
                const selectionKind = event.currentTarget
                  .value as AnalysisHistoryFilters["selectionKind"];
                setDraftFilters((value) => ({ ...value, selectionKind }));
              }}
              value={draftFilters.selectionKind}
            >
              <option value="">全部</option>
              <option value="phrase">短语</option>
              <option value="sentence">句子</option>
              <option value="passage">段落</option>
            </select>
          </label>
          <button type="submit">应用筛选</button>
        </form>
        <p aria-atomic="true" aria-live="polite" className="analysis-history-status" role="status">
          {status}
        </p>
        {error !== "" && <p role="alert">{error}</p>}
        {loadState === "loading" && <p role="status">正在载入分析历史…</p>}
        {loadState === "error" && (
          <button data-retry-history onClick={() => void load()} type="button">
            重试
          </button>
        )}
        {loadState === "empty" && <p>当前筛选下没有分析记录。</p>}
        {loadState === "ready" && (
          <div className="analysis-history-layout">
            <section aria-label="分析历史列表" className="analysis-history-list">
              {items.map((item) => (
                <button
                  aria-pressed={detail?.id === item.id}
                  data-open-analysis
                  key={item.id}
                  onClick={() => void open(item.id)}
                  type="button"
                >
                  <strong>{item.source.title ?? item.sourceText}</strong>
                  <span>
                    {item.reviewState === "reviewed" ? "已整理" : "待整理"} ·{" "}
                    {item.archivedAt === null ? "未归档" : "已归档"}
                  </span>
                </button>
              ))}
              {nextCursor !== null && (
                <button data-more-history onClick={() => void load(nextCursor)} type="button">
                  加载更多
                </button>
              )}
            </section>
            <section aria-live="polite" className="analysis-history-detail">
              {detail === null ? (
                <p>选择记录查看完整分析。</p>
              ) : (
                <>
                  <h2 ref={detailHeading} tabIndex={-1}>
                    {detail.source.title ?? "分析详情"}
                  </h2>
                  <p>整理状态与归档状态彼此独立。</p>
                  <AnalysisHistoryDetail record={detail} />
                  <AnalysisHistoryActions
                    actionBusy={actionBusy}
                    confirmButton={confirmButton}
                    confirmingDelete={confirmingDelete}
                    deleteStudyCapture={deleteStudyCapture}
                    onArchive={() =>
                      void mutate("归档", (record) =>
                        api.archiveAnalysis(record.id, record.revision, idempotencyKey()),
                      )
                    }
                    onCancelDelete={() => setConfirmingDelete(false)}
                    onConfirmDelete={() => void remove()}
                    onDeleteStudyCaptureChange={setDeleteStudyCapture}
                    onProcess={() =>
                      void mutate("标记已整理", (record) =>
                        api.processNothingToSave(record.id, record.revision, idempotencyKey()),
                      )
                    }
                    onRestore={() =>
                      void mutate("恢复", (record) =>
                        api.restoreAnalysis(record.id, record.revision, idempotencyKey()),
                      )
                    }
                    onStartDelete={() => setConfirmingDelete(true)}
                    record={detail}
                  />
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </PracticeShell>
  );
}

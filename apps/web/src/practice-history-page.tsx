import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type {
  ListPracticeSessionsQuery,
  PracticeHistoryDetailResponse,
  PracticeHistorySummary,
} from "@huayi/cloud-contracts";

import type { PracticeHistoryPageApi } from "./practice-history-page-api.js";
import { PracticeHistoryDetail } from "./practice-history-detail.js";

type LoadState = "empty" | "error" | "loading" | "ready";

const statusText = {
  active: "进行中",
  "awaiting-feedback": "等待生成或反馈",
  completed: "已完成",
  failed: "未完成",
};

function sessionTitle(summary: PracticeHistorySummary) {
  return summary.type === "sentence-creation" ? "句子创作" : "受约束对话";
}

function dateText(summary: PracticeHistorySummary) {
  return new Date(summary.completedAt ?? summary.updatedAt).toLocaleString("zh-CN");
}

export function PracticeHistoryPage({
  api,
  idempotencyKey = () => crypto.randomUUID(),
}: {
  readonly api: PracticeHistoryPageApi;
  readonly idempotencyKey?: () => string;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detail, setDetail] = useState<PracticeHistoryDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PracticeHistorySummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | PracticeHistorySummary["status"]>("");
  const [typeFilter, setTypeFilter] = useState<"" | PracticeHistorySummary["type"]>("");
  const confirmButton = useRef<HTMLButtonElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const detailGeneration = useRef(0);
  const listGeneration = useRef(0);

  const filters = useCallback(
    (cursor?: string): ListPracticeSessionsQuery => ({
      limit: 20,
      ...(cursor === undefined ? {} : { cursor }),
      ...(statusFilter === "" ? {} : { status: statusFilter }),
      ...(typeFilter === "" ? {} : { type: typeFilter }),
    }),
    [statusFilter, typeFilter],
  );

  const load = useCallback(
    async (cursor?: string) => {
      const generation = ++listGeneration.current;
      if (cursor === undefined) setLoadState("loading");
      setError(null);
      try {
        const response = await api.listPracticeHistory(filters(cursor));
        if (generation !== listGeneration.current) return false;
        setItems((current) =>
          cursor === undefined ? response.items : [...current, ...response.items],
        );
        setNextCursor(response.nextCursor);
        if (cursor === undefined) setLoadState(response.items.length === 0 ? "empty" : "ready");
        return true;
      } catch {
        if (generation !== listGeneration.current) return false;
        setError("暂时无法载入练习历史，请检查网络后重试。");
        if (cursor === undefined) setLoadState("error");
        return false;
      }
    },
    [api, filters],
  );

  useEffect(() => {
    void load();
    return () => {
      listGeneration.current += 1;
      detailGeneration.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (detail !== null) detailHeading.current?.focus();
  }, [detail]);
  useEffect(() => {
    if (confirmDelete) confirmButton.current?.focus();
  }, [confirmDelete]);

  const open = async (id: string) => {
    const generation = ++detailGeneration.current;
    setError(null);
    setConfirmDelete(false);
    try {
      const response = await api.getPracticeHistory(id);
      if (generation !== detailGeneration.current) return false;
      setDetail(response);
      return true;
    } catch {
      if (generation !== detailGeneration.current) return false;
      setError("暂时无法载入这次练习，请重试。");
      return false;
    }
  };

  const remove = async () => {
    if (detail === null) return;
    const generation = detailGeneration.current;
    setPending(true);
    setError(null);
    try {
      await api.deletePracticeHistory(
        detail.session.id,
        { expectedRevision: detail.session.revision },
        idempotencyKey(),
      );
      if (generation !== detailGeneration.current) return;
      if (!(await load())) throw new Error("History refresh failed.");
      detailGeneration.current += 1;
      setDetail(null);
      setConfirmDelete(false);
      setStatus("练习历史已删除；学习项排期保持不变。");
      heading.current?.focus();
    } catch {
      if (generation === detailGeneration.current) {
        setError("暂时无法删除这次练习；详情已保留。进行中或等待反馈的记录不能删除。");
      }
    } finally {
      if (generation === detailGeneration.current) setPending(false);
    }
  };

  const submitFilters = (event: FormEvent) => {
    event.preventDefault();
    detailGeneration.current += 1;
    setDetail(null);
    void load();
  };

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">PRACTICE HISTORY</p>
          <h1 ref={heading} tabIndex={-1}>
            练习历史
          </h1>
        </div>
        <p>浏览正式练习记录；删除历史不会回退学习项排期。</p>
      </header>
      <p>
        <a href="/practice">返回今日练习</a>
      </p>
      <form className="practice-history-filters" onSubmit={submitFilters}>
        <label>
          类型
          <select
            name="type"
            onChange={(event) => setTypeFilter(event.currentTarget.value as typeof typeFilter)}
            value={typeFilter}
          >
            <option value="">全部</option>
            <option value="sentence-creation">句子创作</option>
            <option value="dialogue">受约束对话</option>
          </select>
        </label>
        <label>
          状态
          <select
            name="status"
            onChange={(event) => setStatusFilter(event.currentTarget.value as typeof statusFilter)}
            value={statusFilter}
          >
            <option value="">全部</option>
            <option value="active">进行中</option>
            <option value="awaiting-feedback">等待反馈</option>
            <option value="completed">已完成</option>
            <option value="failed">未完成</option>
          </select>
        </label>
        <button type="submit">应用筛选</button>
      </form>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      {loadState === "loading" && <p role="status">正在载入练习历史…</p>}
      {error !== null && (
        <div className="alert" role="alert">
          <p>{error}</p>
          {loadState === "error" && (
            <button data-retry-history onClick={() => void load()} type="button">
              重新载入
            </button>
          )}
        </div>
      )}
      {loadState === "empty" && (
        <section className="empty-state">
          <h2>还没有练习记录</h2>
          <p>完成或开始一次正式练习后，记录会出现在这里。</p>
        </section>
      )}
      {loadState === "ready" && (
        <div className="practice-history-layout">
          <section aria-label="练习记录" className="practice-history-list">
            <h2>记录 {items.length}</h2>
            {items.map((item) => (
              <button
                aria-pressed={detail?.session.id === item.id}
                data-open-session
                key={item.id}
                onClick={() => void open(item.id)}
                type="button"
              >
                <strong>{sessionTitle(item)}</strong>
                <span>
                  {statusText[item.status]} · {dateText(item)}
                </span>
                <small>
                  {item.items.length} 个学习项
                  {item.items.some(
                    ({ learningItemDeletedAt }) => learningItemDeletedAt !== undefined,
                  )
                    ? " · 含已删除学习项"
                    : ""}
                </small>
              </button>
            ))}
            {nextCursor !== null && (
              <button data-load-more onClick={() => void load(nextCursor)} type="button">
                载入更多
              </button>
            )}
          </section>
          <section aria-live="polite" className="practice-history-detail">
            {detail === null ? (
              <p>选择一条记录查看完整练习。</p>
            ) : (
              <>
                <p className="eyebrow">{detail.session.id}</p>
                <h2 ref={detailHeading} tabIndex={-1}>
                  {detail.session.type === "sentence-creation" ? "句子创作详情" : "受约束对话详情"}
                </h2>
                <PracticeHistoryDetail detail={detail} />
                {(detail.session.status === "completed" || detail.session.status === "failed") && (
                  <button
                    className="danger-button"
                    data-delete-session
                    disabled={pending}
                    onClick={() => setConfirmDelete(true)}
                    type="button"
                  >
                    删除这次练习
                  </button>
                )}
                {confirmDelete && (
                  <div
                    className="practice-history-delete"
                    role="group"
                    aria-label="确认删除练习历史"
                  >
                    <p>确认删除？答案、对话和反馈会被删除，但学习项排期不会回退。</p>
                    <button
                      className="danger-button"
                      data-confirm-delete-session
                      disabled={pending}
                      onClick={() => void remove()}
                      ref={confirmButton}
                      type="button"
                    >
                      确认删除
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => setConfirmDelete(false)}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

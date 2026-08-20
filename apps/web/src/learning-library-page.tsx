import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { LearningItemDetailResponse, ListLearningItemsQuery } from "@huayi/cloud-contracts";

import { LearningItemMaintenancePanel } from "./learning-item-maintenance-panel.js";
import type { LearningLibraryApi } from "./learning-library-api-port.js";
import { ManualLearningItemForm } from "./manual-learning-item-form.js";

export type { LearningLibraryApi } from "./learning-library-api-port.js";

type LoadState = "empty" | "error" | "loading" | "ready";

function primaryText(view: LearningItemDetailResponse) {
  return view.item.content.type === "expression"
    ? view.item.content.text
    : view.item.content.template;
}

function meaning(view: LearningItemDetailResponse) {
  return view.item.content.type === "expression"
    ? view.item.content.meaningZh
    : view.item.content.functionZh;
}

function scheduleText(view: LearningItemDetailResponse) {
  if (view.archivedAt !== null) {
    return `已归档：${new Date(view.archivedAt).toLocaleDateString("zh-CN")}；恢复后沿用原排期`;
  }
  if (view.schedule.level === -1) return "新学习项";
  return view.schedule.dueAt === null
    ? "排期待确认"
    : `下次练习：${new Date(view.schedule.dueAt).toLocaleDateString("zh-CN")}`;
}

function SourceExamples({ detail }: { readonly detail: LearningItemDetailResponse }) {
  return (
    <section aria-labelledby={`sources-${detail.item.id}`} className="source-examples">
      <h3 id={`sources-${detail.item.id}`}>来源示例</h3>
      {detail.item.sourceExamples.length === 0 ? (
        <p>这条学习项没有关联来源。</p>
      ) : (
        <ul>
          {detail.item.sourceExamples.map((source) => (
            <li key={source.id}>
              <strong>{source.sourceTitle ?? "未命名来源"}</strong>
              <blockquote>{source.sourceText}</blockquote>
              {source.translationZh === undefined ? null : <p>{source.translationZh}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LearningLibraryPage({ api }: { readonly api: LearningLibraryApi }) {
  const [archived, setArchived] = useState(false);
  const [detail, setDetail] = useState<LearningItemDetailResponse | null>(null);
  const [due, setDue] = useState<"" | "due" | "new">("");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<LearningItemDetailResponse[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [systemAttribute, setSystemAttribute] = useState("");
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [type, setType] = useState<"" | "expression" | "sentence-pattern">("");
  const heading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const detailGeneration = useRef(0);
  const listGeneration = useRef(0);

  const filters = useCallback(
    (cursor?: string): ListLearningItemsQuery => ({
      archived,
      limit: 20,
      ...(cursor === undefined ? {} : { cursor }),
      ...(due === "" ? {} : { due }),
      ...(query.trim() === "" ? {} : { query }),
      ...(systemAttribute.trim() === "" ? {} : { systemAttribute }),
      ...(tag.trim() === "" ? {} : { tag }),
      ...(type === "" ? {} : { type }),
    }),
    [archived, due, query, systemAttribute, tag, type],
  );

  const load = useCallback(
    async (cursor?: string) => {
      const generation = listGeneration.current + 1;
      listGeneration.current = generation;
      if (cursor === undefined) {
        detailGeneration.current += 1;
        setLoadState("loading");
      }
      setError(null);
      try {
        const response = await api.listLearningItems(filters(cursor));
        if (generation !== listGeneration.current) return false;
        setItems((current) =>
          cursor === undefined ? response.items : [...current, ...response.items],
        );
        setNextCursor(response.nextCursor);
        if (cursor === undefined) {
          setDetail(null);
          setLoadState(response.items.length === 0 ? "empty" : "ready");
        }
        return true;
      } catch {
        if (generation !== listGeneration.current) return false;
        setError("暂时无法载入学习库，请检查网络后重试。");
        if (cursor === undefined) setLoadState("error");
        return false;
      }
    },
    [api, filters],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      listGeneration.current += 1;
      detailGeneration.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (detail !== null) detailHeading.current?.focus();
  }, [detail]);

  const submitFilters = (event: FormEvent) => {
    event.preventDefault();
    void load();
  };

  const open = async (id: string) => {
    const generation = detailGeneration.current + 1;
    detailGeneration.current = generation;
    setError(null);
    try {
      const response = await api.getLearningItem(id);
      if (generation !== detailGeneration.current) return false;
      setDetail(response);
      return true;
    } catch {
      if (generation !== detailGeneration.current) return false;
      setError("暂时无法载入这条学习项，请重试。");
      return false;
    }
  };

  const maintenance = (current: LearningItemDetailResponse) => (
    <LearningItemMaintenancePanel
      api={api}
      detail={current}
      idempotencyKey={() => crypto.randomUUID()}
      onDeleted={async (response) => {
        if (!(await load())) throw new Error("Deleted item refresh failed.");
        setDetail(null);
        setStatus(
          response.deletionKind === "erased"
            ? "学习项内容已永久删除；既有练习历史仍保留。"
            : "学习项已删除。规范化标签保留供其他学习项复用。",
        );
        heading.current?.focus();
      }}
      onUpdated={async (updated, message) => {
        const listLoaded = await load();
        const detailLoaded = await open(updated.item.id);
        if (!listLoaded || !detailLoaded) throw new Error("Updated item refresh failed.");
        setStatus(message);
      }}
    />
  );

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">LIBRARY</p>
          <h1 ref={heading} tabIndex={-1}>
            学习库
          </h1>
        </div>
        <p>浏览、维护和归档已确认的表达与句型；排期与练习记录由云端持续保留。</p>
      </header>
      <form className="library-filters" onSubmit={submitFilters}>
        <label>
          类型
          <select
            name="type"
            onChange={(event) => setType(event.currentTarget.value as typeof type)}
            value={type}
          >
            <option value="">全部</option>
            <option value="expression">表达</option>
            <option value="sentence-pattern">句型</option>
          </select>
        </label>
        <label>
          状态
          <select
            name="archived"
            onChange={(event) => setArchived(event.currentTarget.value === "true")}
            value={String(archived)}
          >
            <option value="false">使用中</option>
            <option value="true">已归档</option>
          </select>
        </label>
        <label>
          排期
          <select
            name="due"
            onChange={(event) => setDue(event.currentTarget.value as typeof due)}
            value={due}
          >
            <option value="">全部</option>
            <option value="due">已到期</option>
            <option value="new">新学习项</option>
          </select>
        </label>
        <label>
          标签
          <input name="tag" onChange={(event) => setTag(event.currentTarget.value)} value={tag} />
        </label>
        <label>
          系统属性
          <input
            name="systemAttribute"
            onChange={(event) => setSystemAttribute(event.currentTarget.value)}
            value={systemAttribute}
          />
        </label>
        <label>
          文本搜索
          <input
            maxLength={200}
            name="query"
            onChange={(event) => setQuery(event.currentTarget.value)}
            value={query}
          />
        </label>
        <button type="submit">应用筛选</button>
      </form>
      <ManualLearningItemForm
        createLearningItem={api.createLearningItem}
        idempotencyKey={() => crypto.randomUUID()}
        onCreated={async (created) => {
          const listLoaded = await load();
          const detailLoaded = await open(created.item.id);
          if (!listLoaded || !detailLoaded) throw new Error("Created item refresh failed.");
          setStatus("已收录并从学习库重新载入。详情已打开。");
        }}
      />
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      {loadState === "loading" && <p role="status">正在载入学习库…</p>}
      {error !== null && (
        <div className="alert" role="alert">
          <p>{error}</p>
          {loadState === "error" && (
            <button data-retry-library onClick={() => void load()} type="button">
              重新载入
            </button>
          )}
        </div>
      )}
      {loadState === "empty" && (
        <>
          <section className="empty-state">
            <h2>当前筛选下没有学习项</h2>
            <p>可使用上方表单手动收录，也可调整筛选或在待整理中确认表达与句型。</p>
          </section>
          {detail !== null && (
            <section aria-live="polite" className="library-detail">
              <p className="eyebrow">
                {detail.item.type === "expression" ? "EXPRESSION" : "SENTENCE PATTERN"}
              </p>
              <h2 ref={detailHeading} tabIndex={-1}>
                {primaryText(detail)}
              </h2>
              <p>{meaning(detail)}</p>
              <p>{detail.item.content.usageZh}</p>
              <p>{scheduleText(detail)}</p>
              <SourceExamples detail={detail} />
              {maintenance(detail)}
            </section>
          )}
        </>
      )}
      {loadState === "ready" && (
        <div className="library-layout">
          <section aria-label="学习项" className="library-list">
            <h2>学习项 {items.length}</h2>
            {items.map((view) => (
              <button
                aria-pressed={detail?.item.id === view.item.id}
                data-open-item
                key={view.item.id}
                onClick={() => void open(view.item.id)}
                type="button"
              >
                <strong>{primaryText(view)}</strong>
                <span>{meaning(view)}</span>
                <small>{scheduleText(view)}</small>
              </button>
            ))}
            {nextCursor !== null && (
              <button data-load-more onClick={() => void load(nextCursor)} type="button">
                载入更多
              </button>
            )}
          </section>
          <section aria-live="polite" className="library-detail">
            {detail === null ? (
              <p>选择一个学习项查看详情。</p>
            ) : (
              <>
                <p className="eyebrow">
                  {detail.item.type === "expression" ? "EXPRESSION" : "SENTENCE PATTERN"}
                </p>
                <h2 ref={detailHeading} tabIndex={-1}>
                  {primaryText(detail)}
                </h2>
                <p>{meaning(detail)}</p>
                <p>{detail.item.content.usageZh}</p>
                <p>{scheduleText(detail)}</p>
                <p>
                  {detail.recentPractice === null
                    ? "还没有完成练习"
                    : `最近练习：${new Date(detail.recentPractice.completedAt).toLocaleDateString("zh-CN")}`}
                </p>
                <p>标签：{detail.item.tags.join("、") || "无"}</p>
                <p>系统属性：{detail.item.systemAttributes.join("、") || "无"}</p>
                <SourceExamples detail={detail} />
                {maintenance(detail)}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

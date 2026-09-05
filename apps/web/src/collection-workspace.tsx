import { useRef, useState } from "react";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import type { InboxApi } from "./inbox-app.js";
import { collectionStatus } from "./collection-model.js";
import { CollectionReview } from "./collection-review.js";
import { useCollectionWorkspace } from "./use-collection-workspace.js";
import type { CandidateDraft } from "./candidate-editor.js";
interface Metadata {
  title: string;
  userContext: string;
  kind: "phrase" | "sentence" | "passage";
}
const empty: Metadata = { title: "", userContext: "", kind: "sentence" };
export function CollectionWorkspace({
  captureApi,
  reviewApi,
  createIdempotencyKey = () => crypto.randomUUID(),
  pasteDefault = false,
}: {
  captureApi: WebStudyCaptureApi;
  reviewApi: InboxApi;
  createIdempotencyKey?: (() => string) | undefined;
  pasteDefault?: boolean;
}) {
  const state = useCollectionWorkspace(captureApi, reviewApi, createIdempotencyKey);
  const [pasteOpen, setPasteOpen] = useState(
    pasteDefault || new URLSearchParams(window.location.search).has("paste"),
  );
  const [source, setSource] = useState("");
  const [pasteMeta, setPasteMeta] = useState<Metadata>(empty);
  const [metadata, setMetadata] = useState<Record<string, Metadata>>({});
  const reviewDrafts = useRef(new Map<string, CandidateDraft[]>());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filter, setFilter] = useState("unfinished");
  const selected = state.selected;
  const capture = selected?.capture?.capture;
  const draft = selected
    ? (metadata[selected.id] ?? {
        title: capture?.title ?? "",
        userContext: capture?.userContext ?? "",
        kind: capture?.kind ?? "sentence",
      })
    : empty;
  const job = selected?.task;
  const generating = job
    ? ["queued", "running", "cancelling"].includes(job.state)
    : capture?.status === "analyzing";
  const visible = state.entries.filter(
    (entry) =>
      filter === "all" ||
      (filter === "unfinished"
        ? collectionStatus(entry) !== "已整理"
        : collectionStatus(entry) === filter),
  );
  const update = (patch: Partial<Metadata>) => {
    if (selected) setMetadata((values) => ({ ...values, [selected.id]: { ...draft, ...patch } }));
  };
  return (
    <div className="study-inbox collection-workspace">
      <header className="page-heading">
        <div>
          <h1>收集箱</h1>
          <p>保留原文 → 深度分析 → 选择学习内容 → 练习使用</p>
        </div>
        <button onClick={() => setPasteOpen((value) => !value)} type="button">
          {pasteOpen ? "收起粘贴" : "粘贴原文"}
        </button>
      </header>
      {pasteOpen && (
        <form
          className="collection-paste"
          onSubmit={(event) => {
            event.preventDefault();
            void state.paste(source, pasteMeta, true);
          }}
        >
          <label>
            想学习的英文原文
            <textarea
              maxLength={2000}
              name="sourceText"
              onChange={(event) => setSource(event.currentTarget.value)}
              required
              value={source}
            />
          </label>
          <small>{source.length} / 2000</small>
          <label>
            内容类型
            <select
              value={pasteMeta.kind}
              onChange={(event) =>
                setPasteMeta({ ...pasteMeta, kind: event.currentTarget.value as Metadata["kind"] })
              }
            >
              <option value="phrase">短语</option>
              <option value="sentence">句子</option>
              <option value="passage">段落</option>
            </select>
          </label>
          <details>
            <summary>添加标题与学习上下文（可选）</summary>
            <label>
              标题
              <input
                maxLength={500}
                value={pasteMeta.title}
                onChange={(event) =>
                  setPasteMeta({ ...pasteMeta, title: event.currentTarget.value })
                }
              />
            </label>
            <label>
              学习上下文
              <textarea
                maxLength={1000}
                value={pasteMeta.userContext}
                onChange={(event) =>
                  setPasteMeta({ ...pasteMeta, userContext: event.currentTarget.value })
                }
              />
            </label>
          </details>
          <div className="form-actions">
            <button disabled={state.busy || !source.trim()} type="submit">
              保存并开始分析
            </button>
            <button
              disabled={state.busy || !source.trim()}
              onClick={() => void state.paste(source, pasteMeta, false)}
              type="button"
            >
              只加入收集箱
            </button>
          </div>
        </form>
      )}
      <div className="study-inbox-toolbar">
        <label>
          显示内容
          <select value={filter} onChange={(event) => setFilter(event.currentTarget.value)}>
            <option value="unfinished">未整理</option>
            <option value="all">全部内容</option>
            <option value="待分析">待分析</option>
            <option value="排队中">排队中</option>
            <option value="生成中">生成中</option>
            <option value="待选择学习内容">待选择学习内容</option>
            <option value="分析失败">分析失败</option>
            <option value="已整理">已整理</option>
          </select>
        </label>
        <button onClick={() => void state.load()} type="button">
          刷新列表
        </button>
        <a href="/history">分析历史</a>
      </div>
      {state.status && <p role="status">{state.status}</p>}
      {state.error && (
        <div className="alert" role="alert">
          {state.error}
        </div>
      )}
      {state.loading && <p role="status">正在载入收集箱…</p>}
      {!state.loading && state.entries.length === 0 && (
        <section className="empty-state">
          <h2>从一句你想学会使用的话开始</h2>
          <p>在网页查询后加入收集箱，或在这里粘贴原文。</p>
          <button onClick={() => setPasteOpen(true)} type="button">
            粘贴第一条原文
          </button>
        </section>
      )}
      <div className="inbox-layout">
        <aside aria-label="收集内容" className="analysis-list">
          {visible.map((entry) => (
            <button
              aria-pressed={selected?.id === entry.id}
              key={entry.id}
              onClick={() => state.select(entry.id)}
              type="button"
            >
              <strong>{entry.title || entry.sourceText}</strong>
              <small>{collectionStatus(entry)}</small>
            </button>
          ))}
          {state.hasMore && (
            <button disabled={state.busy} onClick={() => void state.more()} type="button">
              载入更多
            </button>
          )}
        </aside>
        {selected && (
          <section className="analysis-detail">
            <header>
              <p>{collectionStatus(selected)}</p>
              <h2>{selected.sourceText}</h2>
            </header>
            {capture && (
              <>
                <details>
                  <summary>标题与学习上下文</summary>
                  <label>
                    标题
                    <input
                      maxLength={500}
                      name="title"
                      value={draft.title}
                      onChange={(event) => update({ title: event.currentTarget.value })}
                    />
                  </label>
                  <label>
                    学习上下文
                    <textarea
                      maxLength={1000}
                      name="userContext"
                      value={draft.userContext}
                      onChange={(event) => update({ userContext: event.currentTarget.value })}
                    />
                  </label>
                  <label>
                    内容类型
                    <select
                      value={draft.kind}
                      onChange={(event) =>
                        update({ kind: event.currentTarget.value as Metadata["kind"] })
                      }
                    >
                      <option value="phrase">短语</option>
                      <option value="sentence">句子</option>
                      <option value="passage">段落</option>
                    </select>
                  </label>
                </details>
                <div className="form-actions">
                  <button
                    data-analyze-capture
                    disabled={state.busy || generating || job?.state === "unknown"}
                    onClick={() => void state.analyze(selected, draft)}
                    type="button"
                  >
                    {capture.status === "analyzed" ? "重新分析" : "开始深度分析"}
                  </button>
                  {generating && (
                    <button
                      disabled={job?.state === "cancelling"}
                      onClick={() => void state.cancel()}
                      type="button"
                    >
                      {job?.state === "cancelling" ? "等待停止确认…" : "停止生成"}
                    </button>
                  )}
                  {capture.status === "pending" && !generating && (
                    <button
                      data-delete-capture
                      onClick={() => setDeleting(selected.id)}
                      type="button"
                    >
                      删除这条原文
                    </button>
                  )}
                </div>
                {deleting === selected.id && (
                  <div role="group" aria-label="确认删除原文">
                    <p>确定删除这条未分析的原文？</p>
                    <button
                      data-confirm-delete-capture
                      disabled={state.busy}
                      onClick={() => void state.remove().then(() => setDeleting(null))}
                      type="button"
                    >
                      确认删除
                    </button>
                    <button onClick={() => setDeleting(null)} type="button">
                      保留原文
                    </button>
                  </div>
                )}
              </>
            )}
            {generating && <p role="status">可以切换内容或离开，回来后继续查看进度。</p>}
            {job?.state === "unknown" && (
              <p role="alert">正在核对同一次生成的结果，请稍后刷新。诊断编号：{job.id}</p>
            )}
            {state.preview && (
              <section className="analysis-previews" aria-label="实时分析预览" aria-live="polite">
                <h3>正在理解原文</h3>
                <p>{state.preview}</p>
              </section>
            )}
            {selected.analysis && (
              <CollectionReview
                draftCache={reviewDrafts.current}
                key={selected.analysis.id}
                analysis={selected.analysis}
                api={reviewApi}
                idempotencyKey={createIdempotencyKey}
                onSaved={state.mergeAnalysis}
                onContinue={() => {
                  const next = visible.find(
                    (entry) => entry.id !== selected.id && collectionStatus(entry) !== "已整理",
                  );
                  if (next) state.select(next.id);
                  else setPasteOpen(true);
                }}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

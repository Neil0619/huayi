import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { WordEntryCore, WordEntryDetailResponse } from "@huayi/cloud-contracts";

import { ManualWordForm } from "./manual-word-form.js";
import { WebWordLibraryApiError, type WebWordLibraryApi } from "./word-library-api.js";

type LoadState = "empty" | "error" | "loading" | "ready";

function saveErrorMessage(error: unknown): string {
  if (error instanceof WebWordLibraryApiError) {
    if (error.code === "revision_conflict") {
      return "词条已在其他页面或设备更新。你的备注草稿仍保留，请重新打开词条后再保存。";
    }
    if (error.code === "authentication_required") {
      return "登录状态已失效。你的备注草稿仍保留，请重新登录后再保存。";
    }
  }
  return "未能确认备注是否保存。已保留了备注草稿，请检查网络后重试。";
}

function deleteErrorMessage(error: unknown): string {
  if (error instanceof WebWordLibraryApiError) {
    if (error.code === "word_entry_in_use") {
      return "这个词条曾参与外部词典同步。为保留当时的同步记录，服务器不能删除它；外部词典中的副本不会受到影响。";
    }
    if (error.code === "revision_conflict") {
      return "词条已在其他页面或设备更新。请重新打开词条后再删除。";
    }
    if (error.code === "authentication_required") {
      return "登录状态已失效，请重新登录后再删除。";
    }
  }
  return "未能确认词条是否删除。请检查网络后重新载入生词列表。";
}

export function WordLibraryPage({
  api,
  idempotencyKey = () => crypto.randomUUID(),
}: {
  readonly api: WebWordLibraryApi;
  readonly idempotencyKey?: (() => string) | undefined;
}) {
  const [confirming, setConfirming] = useState(false);
  const [detail, setDetail] = useState<WordEntryDetailResponse | null>(null);
  const [error, setError] = useState("");
  const [items, setItems] = useState<WordEntryCore[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const confirm = useRef<HTMLButtonElement>(null);
  const detailGeneration = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const listGeneration = useRef(0);

  const load = useCallback(
    async (cursor?: string, preserveOnFailure = false, preserveDetail = false) => {
      const generation = ++listGeneration.current;
      if (cursor === undefined && !preserveOnFailure) setLoadState("loading");
      setError("");
      try {
        const response = await api.listWords({
          limit: 20,
          ...(cursor === undefined ? {} : { cursor }),
          ...(query.trim() === "" ? {} : { query }),
        });
        if (generation !== listGeneration.current) return false;
        setItems((current) => {
          if (cursor === undefined) return response.items;
          const ids = new Set(current.map(({ id }) => id));
          return [...current, ...response.items.filter(({ id }) => !ids.has(id))];
        });
        setNextCursor(response.nextCursor);
        if (cursor === undefined) {
          if (!preserveDetail) {
            detailGeneration.current += 1;
            setDetail(null);
          }
          setLoadState(response.items.length === 0 && !preserveDetail ? "empty" : "ready");
        }
        return true;
      } catch {
        if (generation !== listGeneration.current) return false;
        setError("暂时无法载入生词，请稍后重试。");
        if (cursor === undefined && !preserveOnFailure) setLoadState("error");
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
    },
    [],
  );
  useEffect(() => {
    if (detail !== null) detailHeading.current?.focus();
  }, [detail]);
  useEffect(() => {
    if (confirming) confirm.current?.focus();
  }, [confirming]);

  const open = async (id: string) => {
    const generation = ++detailGeneration.current;
    setError("");
    try {
      const response = await api.getWord(id, { contextLimit: 20 });
      if (generation !== detailGeneration.current) return false;
      setDetail(response);
      setNotes(response.word.notes ?? "");
      setConfirming(false);
      return true;
    } catch {
      if (generation === detailGeneration.current) setError("暂时无法读取这个词条。");
      return false;
    }
  };

  const moreContexts = async () => {
    if (detail?.contexts.nextCursor === null || detail === null) return;
    const generation = ++detailGeneration.current;
    setError("");
    try {
      const response = await api.getWord(detail.word.id, {
        contextCursor: detail.contexts.nextCursor,
        contextLimit: 20,
      });
      if (generation !== detailGeneration.current) return;
      const ids = new Set(detail.contexts.items.map(({ id }) => id));
      setDetail({
        contexts: {
          items: [
            ...detail.contexts.items,
            ...response.contexts.items.filter(({ id }) => !ids.has(id)),
          ],
          nextCursor: response.contexts.nextCursor,
        },
        word: response.word,
      });
    } catch {
      if (generation === detailGeneration.current) setError("暂时无法载入更多语境。");
    }
  };

  const save = async () => {
    if (detail === null) return;
    const wordId = detail.word.id;
    const requestedNotes = notes.trim() === "" ? null : notes;
    setError("");
    try {
      const word = await api.patchWord(
        wordId,
        { expectedRevision: detail.word.revision, notes: requestedNotes },
        idempotencyKey(),
      );
      setDetail((current) => (current === null ? null : { ...current, word }));
      setItems((current) => current.map((entry) => (entry.id === word.id ? word : entry)));
      if (!(await load(undefined, true))) {
        setError("备注已经保存，但暂时无法刷新生词列表。备注草稿已保留。");
        setStatus("备注已经保存。");
        return;
      }
      if (!(await open(word.id))) {
        setError("备注已经保存，但暂时无法重新读取词条详情。备注草稿已保留。");
        setStatus("备注已经保存。");
        return;
      }
      setStatus("备注已保存，并已重新读取服务器词条。");
    } catch (caught) {
      try {
        const verified = await api.getWord(wordId, { contextLimit: 20 });
        if ((verified.word.notes ?? null) === requestedNotes) {
          setDetail(verified);
          setItems((current) =>
            current.map((entry) => (entry.id === verified.word.id ? verified.word : entry)),
          );
          if (!(await load(undefined, true, true))) {
            setError("备注已保存，但暂时无法刷新生词列表。草稿已保留。");
          }
          setStatus("备注已保存，并已从服务器确认。");
          return;
        }
      } catch {
        // An uncertain write is resolved only by an authoritative matching reread.
      }
      setError(saveErrorMessage(caught));
    }
  };

  const remove = async () => {
    if (detail === null) return;
    const wordId = detail.word.id;
    const finishRemoval = async () => {
      setConfirming(false);
      setDetail(null);
      setItems((current) => current.filter((entry) => entry.id !== wordId));
      if (!(await load(undefined, true))) {
        setError("词条已经删除，但暂时无法刷新生词列表。你可以稍后重试载入。");
      }
      setStatus("词条及其语境已删除；其他学习数据没有改变。");
    };
    setError("");
    try {
      await api.deleteWord(wordId, { expectedRevision: detail.word.revision }, idempotencyKey());
      await finishRemoval();
    } catch (caught) {
      try {
        await api.getWord(wordId, { contextLimit: 20 });
      } catch (verificationError) {
        if (
          verificationError instanceof WebWordLibraryApiError &&
          verificationError.code === "not_found"
        ) {
          await finishRemoval();
          return;
        }
      }
      setError(deleteErrorMessage(caught));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void load();
  };

  const refreshSavedWord = async (wordId: string) => {
    if (!(await open(wordId))) return false;
    return load(undefined, true, true);
  };

  return (
    <>
      <div className="word-page">
        <header className="page-heading">
          <div>
            <h1>生词</h1>
          </div>
        </header>
        <nav aria-label="生词设置" className="workspace-section-nav">
          <a aria-current="page" href="#main-content">
            生词
          </a>
          <a href="/words/wordbooks">外部词典</a>
        </nav>
        <details className="utility-disclosure word-tools">
          <summary>搜索与手动收录</summary>
          <div className="utility-disclosure-content">
            <ManualWordForm api={api} idempotencyKey={idempotencyKey} onSaved={refreshSavedWord} />
            <form className="word-filters" onSubmit={submit}>
              <label htmlFor="word-query">搜索规范词头</label>
              <input
                id="word-query"
                maxLength={200}
                name="query"
                onChange={(event) => setQuery(event.currentTarget.value)}
                value={query}
              />
              <button type="submit">搜索</button>
            </form>
          </div>
        </details>
        <p aria-atomic="true" aria-live="polite" className="word-status">
          {status}
        </p>
        {error !== "" && <p role="alert">{error}</p>}
        {loadState === "loading" && <p role="status">正在载入生词…</p>}
        {loadState === "error" && (
          <button data-retry-words onClick={() => void load()} type="button">
            重试
          </button>
        )}
        {loadState === "empty" && <p>当前搜索下没有生词。</p>}
        {loadState === "ready" && (
          <div className="word-layout">
            <section aria-label="生词列表" className="word-list">
              {items.map((word) => (
                <button
                  aria-pressed={detail?.word.id === word.id}
                  data-open-word
                  key={word.id}
                  onClick={() => void open(word.id)}
                  type="button"
                >
                  <strong>{word.headword}</strong>
                  <span>{word.notes ?? "暂无备注"}</span>
                </button>
              ))}
              {nextCursor !== null && (
                <button data-more-words onClick={() => void load(nextCursor)} type="button">
                  加载更多
                </button>
              )}
            </section>
            <section aria-live="polite" className="word-detail">
              {detail === null ? (
                <p>选择词条查看语境和备注。</p>
              ) : (
                <>
                  <h2 ref={detailHeading} tabIndex={-1}>
                    {detail.word.headword}
                  </h2>
                  <label htmlFor="word-notes">备注</label>
                  <textarea
                    id="word-notes"
                    maxLength={4_000}
                    name="notes"
                    onChange={(event) => setNotes(event.currentTarget.value)}
                    value={notes}
                  />
                  <button data-save-notes onClick={() => void save()} type="button">
                    保存备注
                  </button>
                  <h3>语境记录</h3>
                  {detail.contexts.items.length === 0 ? (
                    <p>尚无语境记录。</p>
                  ) : (
                    <ol className="word-contexts">
                      {detail.contexts.items.map((context) => (
                        <li key={context.id}>
                          <p>{context.sourceText ?? "未保存原句"}</p>
                          {context.contextualMeaningZh !== undefined && (
                            <p>{context.contextualMeaningZh}</p>
                          )}
                          <small>{new Date(context.observedAt).toLocaleString("zh-CN")}</small>
                        </li>
                      ))}
                    </ol>
                  )}
                  {detail.contexts.nextCursor !== null && (
                    <button data-more-contexts onClick={() => void moreContexts()} type="button">
                      加载更多语境
                    </button>
                  )}
                  <div className="word-delete">
                    {!confirming ? (
                      <button data-delete-word onClick={() => setConfirming(true)} type="button">
                        删除词条…
                      </button>
                    ) : (
                      <>
                        <p>确认删除这个词条和全部语境？已同步到外部词典的副本不会随之删除。</p>
                        <button
                          data-confirm-delete
                          onClick={() => void remove()}
                          ref={confirm}
                          type="button"
                        >
                          确认删除
                        </button>
                        <button onClick={() => setConfirming(false)} type="button">
                          取消
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

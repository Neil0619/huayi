import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { StudyCaptureDetailResponse } from "@huayi/cloud-contracts";

import type { WebStudyCaptureApi } from "./study-capture-api.js";
import { StudyCaptureDetailPanel } from "./study-capture-detail-panel.js";

export type StudyCaptureStatus = "analyzed" | "analyzing" | "pending" | "unfinished";

const captureStatusLabels = { pending: "待分析", analyzing: "分析中", analyzed: "已分析" };

export function StudyCaptureInbox({
  api,
  captureStatus,
  createIdempotencyKey = () => crypto.randomUUID(),
  onAnalyzed,
}: {
  readonly api: WebStudyCaptureApi;
  readonly captureStatus: StudyCaptureStatus;
  readonly createIdempotencyKey?: () => string;
  readonly onAnalyzed?: () => void;
}) {
  const [items, setItems] = useState<StudyCaptureDetailResponse[]>([]);
  const [detail, setDetail] = useState<StudyCaptureDetailResponse | null>(null);
  const [state, setState] = useState<"empty" | "error" | "loading" | "ready">("loading");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [kind, setKind] = useState<"phrase" | "sentence" | "passage">("sentence");
  const [title, setTitle] = useState("");
  const [userContext, setUserContext] = useState("");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const analysisGeneration = useRef(0);
  const analysisAbort = useRef<AbortController | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);

  const applyDetail = useCallback((value: StudyCaptureDetailResponse) => {
    setDetail(value);
    setKind(value.capture.kind);
    setTitle(value.capture.title ?? "");
    setUserContext(value.capture.userContext ?? "");
    setConfirmDelete(false);
    setActiveRequestId(value.activeAnalysisRequest?.requestId ?? null);
  }, []);

  const open = useCallback(
    async (id: string) => {
      const generation = ++detailGeneration.current;
      setError(null);
      try {
        const loaded = await api.getCapture(id);
        if (generation === detailGeneration.current) applyDetail(loaded);
      } catch {
        if (generation === detailGeneration.current) setError("暂时无法载入这条采集。");
      }
    },
    [api, applyDetail],
  );

  const load = useCallback(
    async (preferredId?: string) => {
      const generation = ++listGeneration.current;
      setState("loading");
      setError(null);
      try {
        const statuses =
          captureStatus === "unfinished" ? (["pending", "analyzing"] as const) : [captureStatus];
        const responses = await Promise.all(statuses.map((status) => api.listCaptures({ status })));
        if (generation !== listGeneration.current) return;
        const captures = new Map<string, StudyCaptureDetailResponse>();
        for (const item of responses.flatMap((response) => response.items)) {
          const previous = captures.get(item.capture.id);
          if (previous === undefined || previous.capture.revision < item.capture.revision) {
            captures.set(item.capture.id, item);
          }
        }
        const loaded = [...captures.values()].sort((a, b) =>
          b.capture.updatedAt.localeCompare(a.capture.updatedAt),
        );
        setItems(loaded);
        setState(loaded.length === 0 ? "empty" : "ready");
        const selected = loaded.find((item) => item.capture.id === preferredId) ?? loaded[0];
        if (selected !== undefined) await open(selected.capture.id);
        else setDetail(null);
      } catch {
        if (generation === listGeneration.current) {
          setState("error");
          setError("暂时无法载入待分析内容，请检查网络后重试。");
        }
      }
    },
    [api, captureStatus, open],
  );

  useEffect(() => {
    void load();
    return () => {
      listGeneration.current += 1;
      detailGeneration.current += 1;
      analysisGeneration.current += 1;
      analysisAbort.current?.abort();
    };
  }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (detail === null) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patchCapture(
        detail.capture.id,
        {
          expectedRevision: detail.capture.revision,
          kind,
          title: title.trim() === "" ? null : title.trim(),
          userContext: userContext.trim() === "" ? null : userContext.trim(),
        },
        createIdempotencyKey(),
      );
      applyDetail(updated);
      setItems((current) =>
        current.map((item) => (item.capture.id === updated.capture.id ? updated : item)),
      );
      setStatus("采集信息已保存。");
    } catch {
      setError("保存失败，当前草稿已保留。请刷新详情或稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  const analyze = async () => {
    if (detail === null) return;
    const generation = ++analysisGeneration.current;
    const controller = new AbortController();
    analysisAbort.current?.abort();
    analysisAbort.current = controller;
    setBusy(true);
    setError(null);
    setStatus("服务器正在生成深度分析；关闭或取消只会停止本页等待。");
    let requestId: string | null = null;
    let terminal = false;
    try {
      for await (const event of api.analyzeCapture(
        detail.capture.id,
        {
          expectedRevision: detail.capture.revision,
          intent: detail.capture.status === "analyzed" ? "reanalysis" : "initial",
        },
        createIdempotencyKey(),
        controller.signal,
      )) {
        if (generation !== analysisGeneration.current) return;
        if (event.type === "analysis.started") {
          requestId = event.requestId;
          setActiveRequestId(event.requestId);
        }
        if (event.type === "analysis.completed") {
          terminal = true;
          setActiveRequestId(null);
          setStatus("深度分析已完成，已进入待收藏。");
          onAnalyzed?.();
          return;
        }
        if (event.type === "analysis.failed") {
          terminal = true;
          setActiveRequestId(null);
          setStatus(null);
          await load(detail.capture.id);
          if (generation === analysisGeneration.current) {
            setError("深度分析失败，原文已保留，可稍后重试；重新分析失败时会保留之前的结果。");
          }
          return;
        }
      }
      if (!terminal && requestId !== null) await recoverRequest(requestId, generation);
    } catch (caught) {
      if (generation !== analysisGeneration.current) return;
      if (requestId !== null && !(caught instanceof DOMException && caught.name === "AbortError")) {
        await recoverRequest(requestId, generation);
      } else if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setStatus(null);
        setError("分析连接中断。服务器可能仍在处理，请稍后刷新状态，勿自动重复扣费。");
      }
    } finally {
      if (generation === analysisGeneration.current) {
        setBusy(false);
        analysisAbort.current = null;
      }
    }
  };

  const recoverRequest = async (requestId: string, generation = analysisGeneration.current) => {
    try {
      const request = await api.getAnalysisRequestStatus(requestId);
      if (generation !== analysisGeneration.current) return;
      if (request.state === "completed") {
        setActiveRequestId(null);
        setStatus("深度分析已完成，已进入待收藏。");
        onAnalyzed?.();
      } else if (request.state === "failed") {
        setActiveRequestId(null);
        setStatus(null);
        await load(detail?.capture.id);
        if (generation === analysisGeneration.current) {
          setError("深度分析失败，原文已保留，可稍后重试；重新分析失败时会保留之前的结果。");
        }
      } else {
        setActiveRequestId(requestId);
        setStatus("服务器仍在处理同一次分析；请稍后检查，不会自动发起新的模型请求。");
      }
    } catch {
      if (generation === analysisGeneration.current) {
        setActiveRequestId(requestId);
        setError("暂时无法确认服务器状态；请稍后检查，不会自动重复分析。");
      }
    }
  };

  const cancelAnalysis = () => {
    analysisGeneration.current += 1;
    analysisAbort.current?.abort();
    analysisAbort.current = null;
    setBusy(false);
    setStatus("已停止本页等待；服务器可能仍会完成并把结果放入待收藏。");
  };

  const remove = async () => {
    if (detail === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteCapture(detail.capture.id, detail.capture.revision, createIdempotencyKey());
      const remaining = items.filter((item) => item.capture.id !== detail.capture.id);
      setItems(remaining);
      setDetail(null);
      setState(remaining.length === 0 ? "empty" : "ready");
      setStatus("采集已删除。");
      listHeading.current?.focus();
      if (remaining[0] !== undefined) await open(remaining[0].capture.id);
    } catch {
      setError("内容已更新或正在分析，请刷新后重试删除。");
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="study-capture-shell">
      <button
        disabled={busy || state === "loading"}
        onClick={() => void load(detail?.capture.id)}
        type="button"
      >
        刷新列表
      </button>
      {status !== null && (
        <p aria-live="polite" role="status">
          {status}
        </p>
      )}
      {error !== null && (
        <div className="alert" role="alert">
          <p>{error}</p>
          {state === "error" && (
            <button onClick={() => void load()} type="button">
              重新载入
            </button>
          )}
        </div>
      )}
      {state === "loading" && <p role="status">正在载入待分析内容…</p>}
      {state === "empty" && (
        <section className="empty-state">
          <h2>还没有待分析内容</h2>
          <p>在网页划词后加入待整理，或直接粘贴内容开始分析。</p>
          <a href="/analysis">粘贴并分析 →</a>
        </section>
      )}
      {state === "ready" && (
        <div className="inbox-layout">
          <aside aria-label="待分析采集" className="analysis-list">
            <h2 ref={listHeading} tabIndex={-1}>
              {captureStatus === "unfinished" ? "未完成" : captureStatusLabels[captureStatus]}{" "}
              {items.length}
            </h2>
            {items.map((item) => (
              <button
                aria-pressed={detail?.capture.id === item.capture.id}
                key={item.capture.id}
                onClick={() => void open(item.capture.id)}
                type="button"
              >
                <strong>{item.capture.title ?? item.capture.kind}</strong>
                <span>{item.capture.sourceText}</span>
                <small>{captureStatusLabels[item.capture.status]}</small>
              </button>
            ))}
          </aside>
          {detail !== null && (
            <StudyCaptureDetailPanel
              activeRequestId={activeRequestId}
              busy={busy}
              confirmDelete={confirmDelete}
              detail={detail}
              kind={kind}
              onAnalyze={() => void analyze()}
              onBeginDelete={() => setConfirmDelete(true)}
              onCancelAnalysis={cancelAnalysis}
              onCancelDelete={() => setConfirmDelete(false)}
              onDelete={() => void remove()}
              onKind={setKind}
              onRecheck={() => activeRequestId !== null && void recoverRequest(activeRequestId)}
              onSubmit={(event) => void save(event)}
              onTitle={setTitle}
              onUserContext={setUserContext}
              title={title}
              userContext={userContext}
            />
          )}
        </div>
      )}
    </div>
  );
}

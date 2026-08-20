import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  startAnalysisRequestSchema,
  type AnalysisEvent,
  type AnalysisRequestStatus,
  type StartAnalysisRequest,
} from "@huayi/cloud-contracts";

export interface PasteAnalysisApi {
  getRequestStatus(requestId: string): Promise<AnalysisRequestStatus>;
  startAnalysis(
    input: StartAnalysisRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): AsyncIterable<AnalysisEvent>;
}

interface PasteAnalysisPageProps {
  readonly api: PasteAnalysisApi;
  readonly createIdempotencyKey?: () => string;
}

type RunState = "cancelled" | "completed" | "failed" | "idle" | "running" | "waiting";

function failureMessage(code: string | undefined) {
  switch (code) {
    case "quota_exhausted":
      return "本月平台额度已用完。输入内容已保留。";
    case "rate_limited":
    case "generation_busy":
      return "当前请求较多，请稍后重试。输入内容已保留。";
    case "model_output_invalid":
      return "模型没有返回可用的完整结构，请重试。输入内容已保留。";
    case "model_unavailable":
      return "模型暂时不可用，请稍后重试。输入内容已保留。";
    default:
      return "分析未能完成，请检查网络后重试。输入内容已保留。";
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export function PasteAnalysisPage({
  api,
  createIdempotencyKey = () => crypto.randomUUID(),
}: PasteAnalysisPageProps) {
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<{ section: string; text: string }[]>([]);
  const [selectionKind, setSelectionKind] =
    useState<StartAnalysisRequest["selectionKind"]>("passage");
  const [unitCount, setUnitCount] = useState<number | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [state, setState] = useState<RunState>("idle");
  const abort = useRef<AbortController | null>(null);
  const runGeneration = useRef(0);

  useEffect(
    () => () => {
      runGeneration.current += 1;
      abort.current?.abort();
    },
    [],
  );

  const applyRecoveredStatus = (status: AnalysisRequestStatus, generation: number) => {
    if (generation !== runGeneration.current) return;
    setError(null);
    if (status.state === "completed") {
      setActiveRequestId(null);
      setAnalysisId(status.analysisId);
      setState("completed");
      return;
    }
    if (status.state === "failed") {
      setActiveRequestId(null);
      setError(failureMessage(status.error.code));
      setState("failed");
      return;
    }
    setState("waiting");
  };

  const recoverRequest = async (requestId: string, generation: number) => {
    try {
      applyRecoveredStatus(await api.getRequestStatus(requestId), generation);
    } catch {
      if (generation !== runGeneration.current) return;
      setError("暂时无法确认服务器状态；请稍后重新检查，不会自动发起第二次分析。");
      setState("waiting");
    }
  };

  const runAnalysis = async () => {
    const generation = runGeneration.current + 1;
    runGeneration.current = generation;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setAnalysisId(null);
    setActiveRequestId(null);
    setError(null);
    setPreviews([]);
    setUnitCount(null);
    setState("running");

    let input: StartAnalysisRequest;
    try {
      input = startAnalysisRequestSchema.parse({
        selectionKind,
        source: { ...(sourceTitle.trim() === "" ? {} : { title: sourceTitle }), type: "manual" },
        sourceText,
      });
    } catch {
      setError("请输入不超过 2,000 个字符的英文内容。");
      setState("failed");
      return;
    }

    let requestId: string | undefined;
    let terminal = false;
    try {
      for await (const event of api.startAnalysis(
        input,
        createIdempotencyKey(),
        controller.signal,
      )) {
        if (generation !== runGeneration.current) return;
        if (event.type === "analysis.started") {
          requestId = event.requestId;
          setActiveRequestId(event.requestId);
          setUnitCount(event.unitCount);
        } else if (event.type === "analysis.preview") {
          setPreviews((current) => [...current, { section: event.section, text: event.text }]);
        } else if (event.type === "analysis.completed") {
          terminal = true;
          setActiveRequestId(null);
          setAnalysisId(event.analysis.id);
          setState("completed");
          break;
        } else {
          terminal = true;
          setActiveRequestId(null);
          setError(failureMessage(event.error.code));
          setState("failed");
          break;
        }
      }
      if (!terminal && requestId !== undefined) await recoverRequest(requestId, generation);
      else if (!terminal && generation === runGeneration.current) {
        setError(failureMessage(undefined));
        setState("failed");
      }
    } catch (caught) {
      if (generation !== runGeneration.current || controller.signal.aborted) return;
      if (requestId !== undefined) await recoverRequest(requestId, generation);
      else {
        setError(failureMessage(errorCode(caught)));
        setState("failed");
      }
    } finally {
      if (generation === runGeneration.current) abort.current = null;
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runAnalysis();
  };

  const cancel = () => {
    runGeneration.current += 1;
    abort.current?.abort();
    abort.current = null;
    setActiveRequestId(null);
    setState("cancelled");
  };

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">ANALYSIS</p>
          <h1>粘贴英文分析</h1>
        </div>
        <p>粘贴你主动选择的英文；只有完整结果会进入待整理。</p>
      </header>
      <div className="analysis-compose-layout">
        <form className="analysis-compose-card" onSubmit={submit}>
          <p className="source-kind">来源：手动粘贴</p>
          <label htmlFor="source-text">英文内容</label>
          <textarea
            disabled={state === "running"}
            id="source-text"
            maxLength={2_000}
            name="sourceText"
            onChange={(event) => {
              setSourceText(event.currentTarget.value);
              if (state === "cancelled" || state === "waiting") setState("idle");
            }}
            required
            rows={10}
            value={sourceText}
          />
          <p className="field-help">最多 2,000 个字符，不会自动截断。</p>
          <label htmlFor="source-title">来源标题（可选）</label>
          <input
            disabled={state === "running"}
            id="source-title"
            maxLength={500}
            name="sourceTitle"
            onChange={(event) => setSourceTitle(event.currentTarget.value)}
            value={sourceTitle}
          />
          <div className="analysis-options">
            <label htmlFor="selection-kind">
              内容类型
              <select
                disabled={state === "running"}
                id="selection-kind"
                name="selectionKind"
                onChange={(event) =>
                  setSelectionKind(
                    event.currentTarget.value as StartAnalysisRequest["selectionKind"],
                  )
                }
                value={selectionKind}
              >
                <option value="phrase">短语</option>
                <option value="sentence">句子</option>
                <option value="passage">段落</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button
              disabled={
                state === "cancelled" ||
                state === "running" ||
                state === "waiting" ||
                sourceText.trim() === ""
              }
              type="submit"
            >
              开始分析
            </button>
            {(state === "running" || state === "waiting") && (
              <button data-cancel-analysis onClick={cancel} type="button">
                取消等待
              </button>
            )}
            {state === "failed" && (
              <button data-retry-analysis onClick={() => void runAnalysis()} type="button">
                重试
              </button>
            )}
          </div>
        </form>
        <section aria-busy={state === "running"} className="analysis-stream-card">
          <h2>分析进度</h2>
          {state === "idle" && <p>提交后，这里会渐进显示临时预览。</p>}
          {state === "running" && (
            <p aria-live="polite" role="status">
              {unitCount === null ? "正在启动分析…" : `分析已开始，共 ${unitCount} 个分析单元。`}
            </p>
          )}
          {previews.length > 0 && (
            <div aria-label="临时预览" aria-live="polite" className="analysis-previews">
              <p className="field-help">临时预览不会保存或用于收藏。</p>
              {previews.map((preview, index) => (
                <article key={`${preview.section}-${index}`}>
                  <strong>{preview.section === "overall" ? "整体" : preview.section}</strong>
                  <p>{preview.text}</p>
                </article>
              ))}
            </div>
          )}
          {state === "cancelled" && (
            <p role="status">
              已取消本页等待；服务端可能仍会完成，输入内容已保留。请稍后检查待整理。
            </p>
          )}
          {state === "waiting" && (
            <div>
              <p role="status">服务器仍在处理；不会在此伪造完成结果或自动重复分析。</p>
              {error !== null && (
                <p className="analysis-error" role="alert">
                  {error}
                </p>
              )}
              {activeRequestId !== null && (
                <button
                  data-check-analysis-status
                  onClick={() => void recoverRequest(activeRequestId, runGeneration.current)}
                  type="button"
                >
                  重新检查状态
                </button>
              )}
            </div>
          )}
          {state === "failed" && error !== null && (
            <p className="analysis-error" role="alert">
              {error}
            </p>
          )}
          {state === "completed" && analysisId !== null && (
            <div className="analysis-completed" role="status">
              <p>分析已完成，并已进入账号的待整理区。</p>
              <a data-open-inbox href="/app">
                前往待整理
              </a>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

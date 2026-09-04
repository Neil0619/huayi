import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { WordbookJobResource } from "@huayi/cloud-contracts";

import type { WebExternalWordbookApi } from "./external-wordbook-api.js";

type LoadState = "empty" | "error" | "loading" | "ready";
type JobChoice = "eudic-export" | "eudic-import" | "shanbay-export";

const stateLabels: Record<WordbookJobResource["state"], string> = {
  active: "处理中",
  cancelled: "已取消",
  completed: "已完成",
  failed: "需要处理",
  pending: "等待插件处理",
  "source-limit-reached": "已到来源页数上限",
};
const errorLabels: Record<string, string> = {
  "authentication-failed": "外部词典授权失效",
  "credential-missing": "插件尚未配置外部词典凭据",
  "data-corrupt": "本地任务数据不可读取",
  "invalid-response": "外部词典返回了无法识别的数据",
  "network-error": "网络暂时不可用",
  "rate-limited": "外部词典暂时限制了请求",
  timeout: "外部词典请求超时",
};

function jobName(job: Pick<WordbookJobResource, "direction" | "target">) {
  const target = job.target === "eudic" ? "欧路词典" : "扇贝";
  return `${target} · ${job.direction === "import" ? "导入" : "导出"}`;
}

function choiceRequest(choice: JobChoice) {
  if (choice === "eudic-import") return { direction: "import" as const, target: "eudic" as const };
  if (choice === "shanbay-export")
    return { direction: "export" as const, target: "shanbay" as const };
  return { direction: "export" as const, target: "eudic" as const };
}

export function ExternalWordbookPage({
  api,
  downloadFile = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.download = filename;
    anchor.href = url;
    anchor.click();
    URL.revokeObjectURL(url);
  },
  idempotencyKey = () => crypto.randomUUID(),
}: {
  readonly api: WebExternalWordbookApi;
  readonly downloadFile?: ((blob: Blob, filename: string) => void) | undefined;
  readonly idempotencyKey?: (() => string) | undefined;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [choice, setChoice] = useState<JobChoice>("eudic-export");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [items, setItems] = useState<WordbookJobResource[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const confirm = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);

  const load = useCallback(
    async (cursor?: string, preserveOnFailure = false) => {
      const current = ++generation.current;
      if (cursor === undefined && !preserveOnFailure) setLoadState("loading");
      setError("");
      try {
        const response = await api.listJobs({
          limit: 20,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (current !== generation.current) return false;
        setItems((existing) => {
          if (cursor === undefined) return response.items;
          const ids = new Set(existing.map(({ id }) => id));
          return [...existing, ...response.items.filter(({ id }) => !ids.has(id))];
        });
        setNextCursor(response.nextCursor);
        if (cursor === undefined) setLoadState(response.items.length === 0 ? "empty" : "ready");
        return true;
      } catch {
        if (current !== generation.current) return false;
        setError("暂时无法载入外部词典任务，请稍后重试。");
        if (cursor === undefined && !preserveOnFailure) setLoadState("error");
        return false;
      }
    },
    [api],
  );

  useEffect(() => void load(), [load]);
  useEffect(() => () => void (generation.current += 1), []);
  useEffect(() => {
    if (confirmingId !== null) confirm.current?.focus();
  }, [confirmingId]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusyId("create");
    setError("");
    try {
      const created = await api.createJob(choiceRequest(choice), idempotencyKey());
      setItems((current) => [created, ...current.filter(({ id }) => id !== created.id)]);
      setLoadState("ready");
      setStatus("任务已创建，已等待配对插件处理。关闭本页不会取消任务。");
      if (!(await load(undefined, true))) {
        setError("任务已经创建，但暂时无法刷新任务列表。");
      }
    } catch {
      setError("无法创建任务。相同目标和方向已有进行中的任务时，请先处理原任务。");
    } finally {
      setBusyId(null);
    }
  };

  const download = async () => {
    setBusyId("download");
    setError("");
    try {
      const file = await api.downloadWords();
      downloadFile(file.blob, file.filename);
      setStatus("互操作词表已下载；它只含规范词头，不是应用数据备份。");
    } catch {
      setError("暂时无法下载互操作词表，请稍后重试。");
    } finally {
      setBusyId(null);
    }
  };

  const act = async (job: WordbookJobResource, action: "cancel" | "retry") => {
    setBusyId(job.id);
    setError("");
    try {
      const updated = await (action === "retry"
        ? api.retryJob(job.id, { expectedRevision: job.revision }, idempotencyKey())
        : api.cancelJob(job.id, { expectedRevision: job.revision }, idempotencyKey()));
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setConfirmingId(null);
      setStatus(action === "retry" ? "任务已重新排队。" : "任务已取消；已同步的内容会保留。");
      if (!(await load(undefined, true))) {
        setError(
          action === "retry"
            ? "任务已经重新排队，但暂时无法刷新任务列表。"
            : "任务已经取消，但暂时无法刷新任务列表。",
        );
      }
    } catch {
      setError(
        action === "retry" ? "无法重试任务，请刷新后再试。" : "无法取消任务，请刷新后再试。",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="wordbook-page">
        <header className="page-heading">
          <div>
            <h1>外部词典任务</h1>
          </div>
        </header>
        <nav aria-label="生词设置" className="workspace-section-nav">
          <a href="/words">生词</a>
          <a aria-current="page" href="#main-content">
            外部词典
          </a>
        </nav>
        <section className="wordbook-create" aria-labelledby="wordbook-create-title">
          <h2 id="wordbook-create-title">创建任务</h2>
          <form data-create-wordbook-job onSubmit={(event) => void create(event)}>
            <fieldset>
              <legend>选择方向</legend>
              {[
                ["eudic-export", "导出到欧路", "词头及可选原句"],
                ["eudic-import", "从欧路导入", "分页面读取生词和可选原句"],
                ["shanbay-export", "导出到扇贝", "仅发送词头"],
              ].map(([value, label, description]) => (
                <label key={value}>
                  <input
                    checked={choice === value}
                    name="wordbook-job-kind"
                    onChange={() => setChoice(value as JobChoice)}
                    type="radio"
                    value={value}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <button disabled={busyId !== null} type="submit">
              {busyId === "create" ? "正在创建…" : "创建任务"}
            </button>
          </form>
          <p className="wordbook-privacy">不会发送备注、释义、页面标题、来源 URL 或插件凭据。</p>
          <button
            data-download-word-list
            disabled={busyId !== null}
            onClick={() => void download()}
            type="button"
          >
            下载互操作词表
          </button>
        </section>
        <p aria-atomic="true" aria-live="polite" className="wordbook-status" role="status">
          {status}
        </p>
        {error !== "" && <p role="alert">{error}</p>}
        {loadState === "loading" && <p>正在载入外部词典任务…</p>}
        {loadState === "error" && (
          <button data-retry-wordbook-jobs onClick={() => void load()} type="button">
            重试载入
          </button>
        )}
        {loadState === "empty" && <p>还没有外部词典任务。你可以从上方创建第一个任务。</p>}
        {loadState === "ready" && (
          <section aria-label="外部词典任务列表" className="wordbook-jobs">
            {items.map((job) => (
              <article className="wordbook-job" key={job.id}>
                <div>
                  <h2>{jobName(job)}</h2>
                  <span className={`job-state job-state-${job.state}`}>
                    {stateLabels[job.state]}
                  </span>
                </div>
                <p>
                  {job.totalCount === null
                    ? `已导入 ${job.processedCount} 项 · 下一页 ${job.nextPage ?? "—"}`
                    : `已完成 ${job.processedCount}/${job.totalCount} · 失败 ${job.failedCount}`}
                </p>
                {job.lastErrorCode !== null && (
                  <p className="job-error">{errorLabels[job.lastErrorCode] ?? "任务处理失败"}</p>
                )}
                <small>更新于 {new Date(job.updatedAt).toLocaleString("zh-CN")}</small>
                <div className="job-actions">
                  {job.state === "failed" && (
                    <button
                      data-retry-job={job.id}
                      disabled={busyId !== null}
                      onClick={() => void act(job, "retry")}
                      type="button"
                    >
                      重试失败项
                    </button>
                  )}
                  {["active", "failed", "pending"].includes(job.state) &&
                    (confirmingId === job.id ? (
                      <div className="job-confirm">
                        <p>确认取消？插件已完成的外部写入无法撤回。</p>
                        <button
                          data-confirm-cancel={job.id}
                          disabled={busyId !== null}
                          onClick={() => void act(job, "cancel")}
                          ref={confirm}
                          type="button"
                        >
                          确认取消
                        </button>
                        <button onClick={() => setConfirmingId(null)} type="button">
                          返回
                        </button>
                      </div>
                    ) : (
                      <button
                        data-cancel-job={job.id}
                        disabled={busyId !== null}
                        onClick={() => setConfirmingId(job.id)}
                        type="button"
                      >
                        取消任务…
                      </button>
                    ))}
                </div>
              </article>
            ))}
            {nextCursor !== null && (
              <button onClick={() => void load(nextCursor)} type="button">
                加载更多任务
              </button>
            )}
          </section>
        )}
      </div>
    </>
  );
}

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  diagnosticQuerySchema,
  type DiagnosticList,
  type DiagnosticQuery,
  type DiagnosticRecord,
} from "@huayi/cloud-contracts";
import type { WebErrorLogsApi } from "./admin-error-logs-api.js";
import { AdminShell } from "./admin-operations-page.js";
import { AdminReauthenticationGate } from "./admin-reauthentication-gate.js";
import { WebIdentityApiError } from "./identity-api.js";

const sources = { api: "语见服务", store: "本机插件", web: "网页" };
function time(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
function ErrorRecord({ record }: { record: DiagnosticRecord }) {
  const e = record.event;
  const facts = [
    ["事件编号", e.id],
    ["请求编号", e.requestId],
    ["任务编号", e.taskId],
    ["生成编号", e.generationId],
    ["诊断编号", e.diagnosticId],
    ["用户编号", record.userId ?? "未关联账号"],
    ["模型服务", e.provider],
    ["客户端版本", e.clientVersion],
    ["服务版本", e.release],
    ["发生时间", time(e.occurredAt)],
    ["接收时间", time(record.receivedAt)],
    ["耗时", e.durationMs === undefined ? undefined : `${e.durationMs} ms`],
    ["调用轮次", e.attempt],
  ];
  return (
    <article className="error-log-record">
      <div className="error-log-row">
        <span className={`error-log-level error-log-level-${e.severity}`}>
          {e.severity === "error" ? "错误" : "警告"}
        </span>
        <div className="error-log-title">
          <strong>{e.code}</strong>
          <span>
            {sources[e.source]} · {e.operation} · {e.stage}
          </span>
        </div>
        {e.httpStatus !== undefined && (
          <span className="error-log-status" aria-label={`HTTP ${e.httpStatus}`}>
            {e.httpStatus}
          </span>
        )}
        <time dateTime={record.receivedAt}>{time(record.receivedAt)}</time>
      </div>
      <details>
        <summary>查看定位信息</summary>
        <dl className="error-log-facts">
          {facts
            .filter(([, value]) => value !== undefined)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
        {!!e.issues?.length && (
          <div>
            <p>输出校验位置{e.issuesTruncated ? "（已截断）" : ""}</p>
            <ul>
              {e.issues.map((issue, index) => (
                <li key={index}>
                  <code>
                    {issue.path.join(".") || "$"} · {issue.code}
                    {issue.rule ? ` · ${issue.rule}` : ""}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </article>
  );
}

export function AdminErrorLogsPage({
  api,
  access,
  onReauthenticate,
}: {
  api: WebErrorLogsApi;
  access: () => Promise<unknown>;
  onReauthenticate?: ((password: string) => Promise<void>) | undefined;
}) {
  const [query, setQuery] = useState<DiagnosticQuery>({ days: "7" });
  const [draft, setDraft] = useState({ days: "7", source: "", severity: "", reference: "" });
  const [data, setData] = useState<DiagnosticList | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "denied" | "reauthentication">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(true);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState("");
  const generation = useRef(0);
  const load = useCallback(
    async (cursor?: string, reauthenticated = false) => {
      const version = ++generation.current;
      setBusy(true);
      setMessage("");
      try {
        await access();
        const next = await api.listErrorLogs({ ...query, ...(cursor ? { cursor } : {}) });
        if (version !== generation.current) return;
        setData((previous) => ({
          ...next,
          items: cursor ? [...(previous?.items ?? []), ...next.items] : next.items,
        }));
        setUpdated(time(new Date().toISOString()));
        setState("ready");
      } catch (error) {
        if (version !== generation.current) return;
        setData(null);
        setState(
          error instanceof WebIdentityApiError && error.code === "forbidden"
            ? onReauthenticate && !reauthenticated
              ? "reauthentication"
              : "denied"
            : "error",
        );
      } finally {
        if (version === generation.current) setBusy(false);
      }
    },
    [access, api, query, onReauthenticate],
  );
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (!refresh || state !== "ready" || (data?.items.length ?? 0) > 30) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !busy) void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh, state, data?.items.length, busy, load]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = diagnosticQuerySchema.safeParse({
      days: draft.days,
      ...(draft.source ? { source: draft.source } : {}),
      ...(draft.severity ? { severity: draft.severity } : {}),
      ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}),
    });
    if (!next.success) {
      setMessage("请输入有效的请求、任务、生成或事件编号（UUID）。");
      return;
    }
    setQuery(next.data);
  };
  return (
    <AdminShell>
      <div className="admin-operations-page error-logs-page">
        <header className="error-logs-heading">
          <div>
            <p className="eyebrow">SERVICE DIAGNOSTICS</p>
            <h1>报错日志</h1>
            <p>自动汇集服务端和已授权插件的错误，按编号定位每次失败。</p>
          </div>
          <a href="/admin">返回运营概览</a>
        </header>
        {state === "reauthentication" && onReauthenticate ? (
          <AdminReauthenticationGate
            onReauthenticate={async (password) => {
              await onReauthenticate(password);
              await load(undefined, true);
            }}
          />
        ) : state === "denied" ? (
          <p role="alert">没有查看报错日志的权限</p>
        ) : state === "error" ? (
          <section className="admin-gate">
            <p role="alert">日志载入失败，请确认登录状态后重试。</p>
            <button onClick={() => void load()} type="button">
              重新载入
            </button>
          </section>
        ) : (
          <>
            <section className="admin-section" aria-label="日志筛选">
              <form className="error-log-filters" onSubmit={submit}>
                <label>
                  时间范围
                  <select
                    value={draft.days}
                    onChange={(e) => setDraft({ ...draft, days: e.currentTarget.value })}
                  >
                    <option value="1">最近 24 小时</option>
                    <option value="7">最近 7 天</option>
                    <option value="30">最近 30 天</option>
                  </select>
                </label>
                <label>
                  来源
                  <select
                    aria-label="来源"
                    value={draft.source}
                    onChange={(e) => setDraft({ ...draft, source: e.currentTarget.value })}
                  >
                    <option value="">全部来源</option>
                    <option value="api">语见服务</option>
                    <option value="store">本机插件</option>
                    <option value="web">网页</option>
                  </select>
                </label>
                <label>
                  级别
                  <select
                    value={draft.severity}
                    onChange={(e) => setDraft({ ...draft, severity: e.currentTarget.value })}
                  >
                    <option value="">错误与警告</option>
                    <option value="error">错误</option>
                    <option value="warn">警告</option>
                  </select>
                </label>
                <label className="error-log-reference">
                  关联编号
                  <input
                    placeholder="请求 / 任务 / 生成 / 事件 UUID"
                    value={draft.reference}
                    onChange={(e) => setDraft({ ...draft, reference: e.currentTarget.value })}
                  />
                </label>
                <button disabled={busy} type="submit">
                  查询
                </button>
              </form>
              {message && <p role="alert">{message}</p>}
            </section>
            {data && (
              <section className="admin-section" aria-label="错误统计">
                <dl className="admin-metrics">
                  {[
                    ["诊断事件", data.summary.events],
                    ["错误事件", data.summary.errors],
                    ["影响用户", data.summary.affectedUsers],
                    ["关联请求 / 任务", data.summary.affectedRequests],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="error-log-note">
                  统计当前筛选范围。一次请求可能产生多条阶段日志；这些数量不代表整体请求失败率。
                </p>
                {data.summary.groups.length > 0 && (
                  <details>
                    <summary>高频问题</summary>
                    <ul className="error-log-groups">
                      {data.summary.groups.map((group) => (
                        <li key={`${group.source}:${group.operation}:${group.code}`}>
                          <span>
                            {sources[group.source]} · {group.operation} · {group.code}
                          </span>
                          <strong>{group.count} 次</strong>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )}
            <section className="admin-section" aria-label="报错记录">
              <div className="admin-section-heading">
                <h2>报错记录</h2>
                <label>
                  <input
                    checked={refresh}
                    onChange={(e) => setRefresh(e.currentTarget.checked)}
                    type="checkbox"
                  />
                  每 30 秒刷新首页
                </label>
                <button disabled={busy} onClick={() => void load()} type="button">
                  刷新
                </button>
              </div>
              <p role="status" aria-live="polite">
                {busy ? "正在读取日志…" : updated ? `更新于 ${updated}` : "正在载入…"}
              </p>
              {data?.items.length === 0 && (
                <p className="error-log-empty">
                  当前范围没有收到错误日志。未授权、未连接账号或尚未更新的插件不会出现在这里。
                </p>
              )}
              {data?.items.map((record) => (
                <ErrorRecord key={record.event.id} record={record} />
              ))}
              {data?.nextCursor && (
                <button
                  disabled={busy}
                  onClick={() => void load(data.nextCursor ?? undefined)}
                  type="button"
                >
                  加载更早记录
                </button>
              )}
            </section>
            <p className="error-log-note">
              日志保留 30
              天，仅含诊断元数据。警告可包含模型输出校验失败等可恢复事件。此页面不会自动修改代码或执行修复。
            </p>
          </>
        )}
      </div>
    </AdminShell>
  );
}

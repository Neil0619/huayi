import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import type { AdminUsageSummary, AdminUserResource } from "@huayi/cloud-contracts";

import type { WebAdminOperationsApi } from "./admin-operations-api.js";
import { AdminReauthenticationGate } from "./admin-reauthentication-gate.js";
import { AdminUserPanel } from "./admin-user-panel.js";
import { AdminSecondaryPanels } from "./admin-secondary-panels.js";
import { WebIdentityApiError, type WebIdentityApi } from "./identity-api.js";

export type AdminReauthenticationApi = Pick<WebIdentityApi, "reauthenticatePassword">;
type LoadState = "denied" | "error" | "loading" | "ready" | "reauthentication";

function AdminShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="operator-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="topbar">
        <span aria-hidden="true" className="brand-mark" />
        <div>
          <strong>语见</strong>
          <span>运营控制台</span>
        </div>
        <a className="operator-back-link" href="/settings/account">
          返回学习工作台
        </a>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export function AdminOperationsPage({
  api,
  csrfToken,
  onCsrfTokenChanged,
  reauthenticationApi,
}: {
  readonly api: WebAdminOperationsApi;
  readonly csrfToken: string;
  readonly onCsrfTokenChanged?: ((csrfToken: string) => void) | undefined;
  readonly reauthenticationApi?: AdminReauthenticationApi | undefined;
}) {
  const [activeCsrfToken, setActiveCsrfToken] = useState(csrfToken);
  const [confirmKill, setConfirmKill] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<"active" | "deleting" | "disabled" | "">("");
  const [usage, setUsage] = useState<AdminUsageSummary | null>(null);
  const [usageError, setUsageError] = useState("");
  const [users, setUsers] = useState<AdminUserResource[]>([]);
  const [userCursor, setUserCursor] = useState<string | null>(null);
  const [userError, setUserError] = useState("");
  const confirmKillRef = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const usageGeneration = useRef(0);
  const userGeneration = useRef(0);

  const load = useCallback(
    async (afterReauthentication = false) => {
      const current = ++generation.current;
      setState("loading");
      setMessage("");
      setUsageError("");
      setUserError("");
      try {
        await api.access();
        const [nextUsage, nextUsers] = await Promise.allSettled([api.getUsage(), api.listUsers()]);
        if (generation.current !== current) return;
        if (nextUsage.status === "fulfilled") setUsage(nextUsage.value);
        else setUsageError("运营概览载入失败。");
        if (nextUsers.status === "fulfilled") {
          setUsers(nextUsers.value.items);
          setUserCursor(nextUsers.value.nextCursor);
        } else setUserError("账号列表载入失败。");
        setState("ready");
      } catch (error) {
        if (generation.current !== current) return;
        if (error instanceof WebIdentityApiError && error.code === "forbidden") {
          setState(
            !afterReauthentication && reauthenticationApi !== undefined
              ? "reauthentication"
              : "denied",
          );
        } else setState("error");
      }
    },
    [api, reauthenticationApi],
  );

  useEffect(() => void load(), [load]);
  useEffect(() => setActiveCsrfToken(csrfToken), [csrfToken]);
  useEffect(() => () => void (generation.current += 1), []);
  useEffect(() => confirmKillRef.current?.focus(), [confirmKill]);

  const reauthenticate = async (password: string) => {
    if (reauthenticationApi === undefined) return;
    const session = await reauthenticationApi.reauthenticatePassword(password, activeCsrfToken);
    setActiveCsrfToken(session.csrfToken);
    onCsrfTokenChanged?.(session.csrfToken);
    await load(true);
  };

  const filterUsers = async (event: FormEvent) => {
    event.preventDefault();
    const current = ++userGeneration.current;
    setMessage("");
    try {
      const result = await api.listUsers(query || undefined, status || undefined, undefined);
      if (current !== userGeneration.current) return;
      setUsers(result.items);
      setUserCursor(result.nextCursor);
      setUserError("");
    } catch {
      if (current !== userGeneration.current) return;
      setUserError("账号筛选失败，已保留当前列表。");
    }
  };

  const loadMoreUsers = async () => {
    if (userCursor === null) return;
    const currentGeneration = ++userGeneration.current;
    try {
      const result = await api.listUsers(query || undefined, status || undefined, userCursor);
      if (currentGeneration !== userGeneration.current) return;
      setUsers((current) => [
        ...current,
        ...result.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setUserCursor(result.nextCursor);
      setUserError("");
    } catch {
      if (currentGeneration !== userGeneration.current) return;
      setUserError("下一页账号载入失败，已保留当前列表。");
    }
  };

  const refreshUsers = async () => {
    const current = ++userGeneration.current;
    try {
      const result = await api.listUsers(query || undefined, status || undefined, undefined);
      if (current !== userGeneration.current) return false;
      setUsers(result.items);
      setUserCursor(result.nextCursor);
      setUserError("");
      return true;
    } catch {
      if (current !== userGeneration.current) return false;
      setUserError("账号列表载入失败，已保留服务器确认的操作结果。");
      return false;
    }
  };

  const retryUsage = async () => {
    const current = ++usageGeneration.current;
    try {
      const result = await api.getUsage();
      if (current !== usageGeneration.current) return;
      setUsage(result);
      setUsageError("");
    } catch {
      if (current !== usageGeneration.current) return;
      setUsageError("运营概览载入失败。");
    }
  };

  const setKillSwitch = async () => {
    if (usage === null) return;
    const current = ++usageGeneration.current;
    try {
      const killSwitch = await api.setKillSwitch(!usage.killSwitch.enabled);
      if (current !== usageGeneration.current) return;
      setUsage({ ...usage, killSwitch });
      setConfirmKill(false);
      const success = killSwitch.enabled
        ? "平台模型请求已停止。浏览与 BYOK 不受影响。"
        : "平台模型请求已恢复；新的请求仍受账号额度约束。";
      try {
        const refreshed = await api.getUsage();
        if (current !== usageGeneration.current) return;
        setUsage(refreshed);
        setMessage(success);
      } catch {
        if (current !== usageGeneration.current) return;
        setMessage(`${success} 操作已完成，但运营概览刷新失败。`);
      }
    } catch {
      if (current !== usageGeneration.current) return;
      setMessage("熔断状态未变更，请重新认证后重试。");
    }
  };

  if (state === "reauthentication") {
    return (
      <AdminShell>
        <AdminReauthenticationGate onReauthenticate={reauthenticate} />
      </AdminShell>
    );
  }

  if (state !== "ready") {
    return (
      <AdminShell>
        <section className="admin-gate" role={state === "loading" ? undefined : "alert"}>
          <p className="eyebrow">OPERATOR ONLY</p>
          <h1>{state === "loading" ? "正在确认 Operator 权限" : "无法进入运营控制台"}</h1>
          <p role={state === "loading" ? "status" : undefined}>
            {state === "loading"
              ? "正在验证完整 Web 会话、角色与近期认证…"
              : "需要 Operator 角色、完整 Web 会话和 15 分钟内的重新认证。"}
          </p>
          {state === "error" && (
            <button onClick={() => void load()} type="button">
              重试
            </button>
          )}
        </section>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="admin-operations-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">OPERATIONS · METADATA ONLY</p>
            <h1>运营控制台</h1>
          </div>
          <p>仅显示账号、额度、设备数和无正文审计；不提供内容浏览或身份模拟。</p>
        </header>
        <p aria-live="polite" className="admin-live" role="status">
          {message}
        </p>
        {usage === null ? (
          <section className="admin-section" aria-labelledby="usage-title">
            <h2 id="usage-title">当前 UTC 月运营概览</h2>
            <div className="alert" role="alert">
              <p>{usageError || "运营概览尚未载入。"}</p>
              <button onClick={() => void retryUsage()} type="button">
                重试运营概览
              </button>
            </div>
          </section>
        ) : (
          <section className="admin-section" aria-labelledby="usage-title">
            <div className="admin-section-heading">
              <div>
                <h2 id="usage-title">当前 UTC 月运营概览</h2>
                <p>
                  {usage.periodStart} 至 {usage.periodEnd}（结束时刻不含）
                </p>
              </div>
              <button onClick={() => setConfirmKill(true)} type="button">
                {usage.killSwitch.enabled ? "关闭模型熔断" : "启用模型熔断"}
              </button>
            </div>
            <dl className="admin-metrics">
              <div>
                <dt>账号总数</dt>
                <dd>{usage.accounts.total}</dd>
              </div>
              <div>
                <dt>请求成功率</dt>
                <dd>{usage.analysisRequests.successRatePercent}%</dd>
              </div>
              <div>
                <dt>P95 延迟</dt>
                <dd>{usage.analysisRequests.p95LatencyMs} ms</dd>
              </div>
              <div>
                <dt>已使用额度</dt>
                <dd>{usage.quota.usedMicroUsd.toLocaleString("zh-CN")} μUSD</dd>
              </div>
            </dl>
            {confirmKill && (
              <div
                className="admin-confirm admin-global-confirm"
                role="group"
                aria-label="确认模型熔断"
              >
                <p>
                  {usage.killSwitch.enabled
                    ? "恢复后平台模型请求重新受理。"
                    : "这会立即拒绝新的平台模型额度预留；BYOK 不受影响。"}
                </p>
                <button onClick={() => void setKillSwitch()} ref={confirmKillRef} type="button">
                  {usage.killSwitch.enabled ? "确认恢复平台模型请求" : "确认停止平台模型请求"}
                </button>
                <button onClick={() => setConfirmKill(false)} type="button">
                  取消
                </button>
              </div>
            )}
          </section>
        )}
        <section className="admin-section" aria-labelledby="users-title">
          <div className="admin-section-heading">
            <h2 id="users-title">账号管理</h2>
          </div>
          <form
            aria-label="筛选账号"
            className="admin-filter"
            onSubmit={(event) => void filterUsers(event)}
            role="search"
          >
            <label htmlFor="admin-email-query">邮箱搜索</label>
            <input
              id="admin-email-query"
              maxLength={320}
              onChange={(event) => setQuery(event.currentTarget.value)}
              value={query}
            />
            <label htmlFor="admin-status">状态</label>
            <select
              id="admin-status"
              onChange={(event) => setStatus(event.currentTarget.value as typeof status)}
              value={status}
            >
              <option value="">全部</option>
              <option value="active">active</option>
              <option value="disabled">disabled</option>
              <option value="deleting">deleting</option>
            </select>
            <button type="submit">筛选账号</button>
          </form>
          {userError !== "" && (
            <div className="alert" role="alert">
              <p>{userError}</p>
              <button
                onClick={() =>
                  void api
                    .listUsers(query || undefined, status || undefined, undefined)
                    .then((result) => {
                      setUsers(result.items);
                      setUserCursor(result.nextCursor);
                      setUserError("");
                    })
                    .catch(() => setUserError("账号列表载入失败。"))
                }
                type="button"
              >
                重试账号列表
              </button>
            </div>
          )}
          <div className="admin-user-grid">
            {users.map((user) => (
              <AdminUserPanel
                api={api}
                key={user.id}
                onUpdated={(updated) =>
                  setUsers((current) =>
                    current.map((item) => (item.id === updated.id ? updated : item)),
                  )
                }
                onRefresh={refreshUsers}
                user={user}
              />
            ))}
          </div>
          {users.length === 0 && userError === "" && <p>没有符合条件的账号。</p>}
          {userCursor !== null && (
            <button onClick={() => void loadMoreUsers()} type="button">
              载入更多账号
            </button>
          )}
        </section>
        <AdminSecondaryPanels api={api} />
      </div>
    </AdminShell>
  );
}

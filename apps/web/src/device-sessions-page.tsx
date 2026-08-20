import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionSessionResource } from "@huayi/cloud-contracts";

import type { WebIdentityApi } from "./identity-api.js";

export type DeviceSessionsApi = Pick<
  WebIdentityApi,
  "listExtensionSessions" | "revokeExtensionSession"
>;

interface DeviceSessionsPageProps {
  readonly api: DeviceSessionsApi;
  readonly csrfToken: string;
}

type LoadState = "empty" | "error" | "loading" | "ready";

const navigation = [
  { href: "/", label: "今日练习" },
  { href: "/app", label: "待整理" },
  { href: "/analysis", label: "分析" },
  { href: "/library", label: "学习库" },
  { href: "/words", label: "生词" },
  { href: "/history", label: "分析历史" },
  { href: "/settings/account", label: "设置" },
];

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function DeviceSessionsPage({ api, csrfToken }: DeviceSessionsPageProps) {
  const [sessions, setSessions] = useState<ExtensionSessionResource[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const response = await api.listExtensionSessions();
      setSessions(response.items);
      setLoadState(response.items.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
      setError("无法载入设备列表，请检查网络后重试。");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (confirmingId !== null) confirmButton.current?.focus();
  }, [confirmingId]);

  useEffect(() => {
    if (status !== null) listHeading.current?.focus();
  }, [loadState, status]);

  const revoke = async (session: ExtensionSessionResource) => {
    setBusyId(session.id);
    setError(null);
    try {
      await api.revokeExtensionSession(session.id, csrfToken);
      const remaining = sessions.filter((candidate) => candidate.id !== session.id);
      setSessions(remaining);
      setLoadState(remaining.length === 0 ? "empty" : "ready");
      setConfirmingId(null);
      setStatus(`已撤销 ${session.deviceLabel} 的服务器会话。`);
    } catch {
      setError("服务器撤销失败，设备会话仍然有效，请稍后重试。");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="topbar">
        <span aria-hidden="true" className="brand-mark" />
        <div>
          <strong>华译</strong>
          <span>Cloud 学习工作台</span>
        </div>
      </header>
      <nav aria-label="主导航" className="sidebar">
        {navigation.map((item) => (
          <a
            aria-current={item.label === "设置" ? "page" : undefined}
            href={item.href}
            key={item.label}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <main id="main-content" tabIndex={-1}>
        <header className="page-heading">
          <div>
            <p className="eyebrow">ACCOUNT SECURITY</p>
            <h1>扩展设备</h1>
          </div>
          <p>查看并撤销由服务器管理的扩展授权。</p>
        </header>
        <nav aria-label="账号设置" className="account-settings-nav">
          <a href="/settings/account">账号与额度</a>
          <a aria-current="page" href="/settings/devices">
            扩展设备
          </a>
          <a href="/settings/data">数据权利</a>
        </nav>
        <p className="device-note">
          这里的撤销会使服务器会话立即失效。扩展 Popup
          的“本机断开”只删除本机凭据，不等同于服务器撤销。
        </p>
        {status !== null && (
          <p aria-live="polite" role="status">
            {status}
          </p>
        )}
        {error !== null && (
          <div className="alert" role="alert">
            <p>{error}</p>
            {loadState === "error" && (
              <button data-retry-devices onClick={() => void load()} type="button">
                重新载入
              </button>
            )}
          </div>
        )}
        {loadState === "loading" && (
          <p aria-live="polite" role="status">
            正在载入设备…
          </p>
        )}
        {loadState === "empty" && (
          <section className="empty-state">
            <h2 ref={listHeading} tabIndex={-1}>
              没有已连接的扩展设备
            </h2>
            <p>从扩展发起配对并在 Web 明确批准后，设备会出现在这里。</p>
          </section>
        )}
        {loadState === "ready" && (
          <section aria-labelledby="device-list-heading" className="device-sessions">
            <h2 id="device-list-heading" ref={listHeading} tabIndex={-1}>
              已连接设备 {sessions.length}
            </h2>
            <ul className="device-list">
              {sessions.map((session) => (
                <li className="device-card" key={session.id}>
                  <div>
                    <h3>{session.deviceLabel}</h3>
                    <dl className="device-meta">
                      <div>
                        <dt>添加时间</dt>
                        <dd>{formatTime(session.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>最近使用</dt>
                        <dd>
                          {session.lastUsedAt === null
                            ? "尚未使用"
                            : formatTime(session.lastUsedAt)}
                        </dd>
                      </div>
                      <div>
                        <dt>会话到期</dt>
                        <dd>{formatTime(session.expiresAt)}</dd>
                      </div>
                    </dl>
                  </div>
                  {confirmingId === session.id ? (
                    <div
                      aria-label={`确认撤销 ${session.deviceLabel}`}
                      className="revocation-confirmation"
                      role="group"
                    >
                      <p>这会立即撤销服务器上的云端授权。确定继续吗？</p>
                      <div className="form-actions">
                        <button
                          className="danger-button"
                          data-confirm-revoke
                          disabled={busyId === session.id}
                          onClick={() => void revoke(session)}
                          ref={confirmButton}
                          type="button"
                        >
                          确认撤销
                        </button>
                        <button
                          disabled={busyId === session.id}
                          onClick={() => setConfirmingId(null)}
                          type="button"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="danger-button"
                      data-request-revoke={session.id}
                      onClick={() => setConfirmingId(session.id)}
                      type="button"
                    >
                      撤销服务器会话
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

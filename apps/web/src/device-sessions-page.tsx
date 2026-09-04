import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionSessionResource } from "@huayi/cloud-contracts";

import { AccountSettingsLayout } from "./account-settings-layout.js";
import type { WebIdentityApi } from "./identity-api.js";

export type DeviceSessionsApi = Pick<
  WebIdentityApi,
  "listExtensionSessions" | "revokeExtensionSession"
>;

interface DeviceSessionsPageProps {
  readonly api: DeviceSessionsApi;
  readonly csrfToken: string;
  readonly showOperatorNavigation?: boolean | undefined;
}

type LoadState = "empty" | "error" | "loading" | "ready";

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function DeviceSessionsPage({
  api,
  csrfToken,
  showOperatorNavigation = false,
}: DeviceSessionsPageProps) {
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
      setStatus(`已断开 ${session.deviceLabel}。`);
    } catch {
      setError("断开失败，该设备仍可访问账号，请稍后重试。");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AccountSettingsLayout active="devices" showOperatorNavigation={showOperatorNavigation}>
      <div className="device-sessions-page">
        <header className="page-heading">
          <div>
            <h1>扩展设备</h1>
          </div>
        </header>
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
                        <dt>授权到期</dt>
                        <dd>{formatTime(session.expiresAt)}</dd>
                      </div>
                    </dl>
                  </div>
                  {confirmingId === session.id ? (
                    <div
                      aria-label={`确认断开 ${session.deviceLabel}`}
                      className="revocation-confirmation"
                      role="group"
                    >
                      <p>断开后，该扩展需要重新连接才能再次访问账号。确定断开吗？</p>
                      <div className="form-actions">
                        <button
                          className="danger-button"
                          data-confirm-revoke
                          disabled={busyId === session.id}
                          onClick={() => void revoke(session)}
                          ref={confirmButton}
                          type="button"
                        >
                          确认断开
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
                      断开设备
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AccountSettingsLayout>
  );
}

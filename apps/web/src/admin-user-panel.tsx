import { useEffect, useRef, useState, type FormEvent } from "react";

import type { AdminUserResource } from "@huayi/cloud-contracts";

import type { WebAdminOperationsApi } from "./admin-operations-api.js";

export function AdminUserPanel({
  api,
  onUpdated,
  onRefresh,
  user,
}: {
  readonly api: WebAdminOperationsApi;
  readonly onUpdated: (user: AdminUserResource) => void;
  readonly onRefresh: () => Promise<boolean>;
  readonly user: AdminUserResource;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"devices" | "status" | null>(null);
  const [message, setMessage] = useState("");
  const [quota, setQuota] = useState(String(user.quota.limitMicroUsd));
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => confirmRef.current?.focus(), [confirm]);

  const act = async (operation: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      await operation();
      setMessage((await onRefresh()) ? success : `${success} 操作已完成，但账号列表刷新失败。`);
      setConfirm(null);
    } catch {
      setMessage("操作未完成。服务器状态没有在本页变更，请刷新后重试。");
    } finally {
      setBusy(false);
    }
  };

  const updateQuota = async (event: FormEvent) => {
    event.preventDefault();
    const limit = Number(quota);
    if (!Number.isSafeInteger(limit) || limit < 0) {
      setMessage("额度必须是非负整数 micro-USD。");
      return;
    }
    await act(async () => {
      const result = await api.setUserQuota(user.id, limit, user.quota.periodStart);
      onUpdated({ ...user, quota: result.quota });
    }, "账号额度已更新。");
  };

  return (
    <article className="admin-user-card">
      <header>
        <div>
          <h3>{user.email}</h3>
          <p>{user.id}</p>
        </div>
        <span className={`admin-status admin-status-${user.status}`}>{user.status}</span>
      </header>
      <dl className="admin-user-facts">
        <div>
          <dt>有效扩展设备</dt>
          <dd>{user.deviceCount}</dd>
        </div>
        <div>
          <dt>月度额度</dt>
          <dd>{user.quota.limitMicroUsd.toLocaleString("zh-CN")} μUSD</dd>
        </div>
      </dl>
      <form className="admin-inline-form" onSubmit={(event) => void updateQuota(event)}>
        <label htmlFor={`quota-${user.id}`}>设置当前 UTC 月额度（micro-USD）</label>
        <div>
          <input
            disabled={busy}
            id={`quota-${user.id}`}
            min="0"
            onChange={(event) => setQuota(event.currentTarget.value)}
            required
            step="1"
            type="number"
            value={quota}
          />
          <button disabled={busy} type="submit">
            更新额度
          </button>
        </div>
      </form>
      <div className="admin-actions">
        <button disabled={busy} onClick={() => setConfirm("devices")} type="button">
          撤销扩展设备
        </button>
        {user.status !== "deleting" && (
          <button disabled={busy} onClick={() => setConfirm("status")} type="button">
            {user.status === "active" ? "停用账号" : "启用账号"}
          </button>
        )}
      </div>
      {confirm === "devices" && (
        <div
          className="admin-confirm"
          role="group"
          aria-label={`确认撤销 ${user.email} 的扩展设备`}
        >
          <p>这会撤销该账号全部 Extension session，不影响 Web 会话。</p>
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const result = await api.revokeUserDevices(user.id);
                onUpdated({
                  ...user,
                  deviceCount: Math.max(0, user.deviceCount - result.revokedCount),
                });
              }, "扩展设备访问已撤销。")
            }
            ref={confirmRef}
            type="button"
          >
            确认撤销全部扩展设备
          </button>
          <button disabled={busy} onClick={() => setConfirm(null)} type="button">
            取消
          </button>
        </div>
      )}
      {confirm === "status" && (
        <div className="admin-confirm" role="group" aria-label={`确认更改 ${user.email} 状态`}>
          <p>
            {user.status === "active"
              ? "停用会撤销 Web、Extension 会话并使未完成配对过期。"
              : "启用只恢复账号状态，不恢复旧会话。"}
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void act(
                async () => {
                  const action = user.status === "active" ? "disable" : "enable";
                  const result = await api.setUserStatus(user.id, action);
                  onUpdated({
                    ...user,
                    status: result.status,
                    ...(action === "disable" ? { deviceCount: 0 } : {}),
                  });
                },
                user.status === "active"
                  ? "账号已停用，并撤销其登录与扩展访问。"
                  : "账号已启用；旧会话不会恢复。",
              )
            }
            ref={confirmRef}
            type="button"
          >
            {user.status === "active" ? `确认停用 ${user.email}` : `确认启用 ${user.email}`}
          </button>
          <button disabled={busy} onClick={() => setConfirm(null)} type="button">
            取消
          </button>
        </div>
      )}
      <p aria-live="polite" className="admin-card-message" role="status">
        {message}
      </p>
    </article>
  );
}

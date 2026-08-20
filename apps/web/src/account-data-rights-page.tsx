import { useCallback, useEffect, useRef, useState } from "react";

import type { AccountDataExportJobResource, AccountDeletionResponse } from "@huayi/cloud-contracts";

import { PracticeShell } from "./practice-shell.js";

export interface AccountDataRightsApi {
  createAccountDataExport(): Promise<AccountDataExportJobResource>;
  deleteAccount(): Promise<AccountDeletionResponse>;
  downloadAccountDataExport(exportId: string): Promise<{ expiresAt: string; url: string }>;
  getCurrentAccountDataExport(): Promise<{ job: AccountDataExportJobResource | null }>;
  retryAccountDataExport(
    exportId: string,
    expectedRevision: number,
  ): Promise<AccountDataExportJobResource>;
}

type LoadState = "error" | "loading" | "ready";

function status(job: AccountDataExportJobResource): string {
  if (job.state === "pending") return "正在等待生成";
  if (job.state === "running") return "正在生成完整数据文件";
  if (job.state === "ready") return "可以下载";
  if (job.state === "failed") return "生成失败，可显式重试";
  return "导出已过期";
}

export function AccountDataRightsPage({
  api,
  onAccountDeleted,
}: {
  readonly api: AccountDataRightsApi;
  readonly onAccountDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [error, setError] = useState("");
  const [job, setJob] = useState<AccountDataExportJobResource | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [understood, setUnderstood] = useState(false);
  const generation = useRef(0);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setError("");
    setLoadState("loading");
    try {
      const response = await api.getCurrentAccountDataExport();
      if (current !== generation.current) return;
      setJob(response.job);
      setLoadState("ready");
    } catch {
      if (current !== generation.current) return;
      setError("无法载入数据权利状态，请检查网络后重试。");
      setLoadState("error");
    }
  }, [api]);

  useEffect(() => void load(), [load]);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);

  const createExport = async () => {
    setBusy(true);
    setError("");
    try {
      setJob(await api.createAccountDataExport());
      setMessage("完整数据导出请求已提交。");
    } catch {
      setError("无法请求完整数据导出，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  const retryExport = async () => {
    if (job === null) return;
    setBusy(true);
    setError("");
    try {
      setJob(await api.retryAccountDataExport(job.id, job.revision));
      setMessage("已重新提交导出生成。");
    } catch {
      setError("无法重试导出；状态可能已经变化，请重新载入。");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (job?.state !== "ready") return;
    setBusy(true);
    setError("");
    try {
      const signed = await api.downloadAccountDataExport(job.id);
      window.open(signed.url, "_blank", "noopener,noreferrer");
      setMessage("已在新窗口打开一次性下载地址；语见不会在浏览器中保存该地址。");
    } catch {
      setError("无法取得下载地址；请确认最近已重新登录，且导出尚未过期。");
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    setError("");
    try {
      await api.deleteAccount();
      setConfirming(false);
      setMessage("删除请求已接受。本机登录已退出，后台删除不可撤销。");
      onAccountDeleted();
    } catch {
      setError("无法提交删除请求；账号未被视为已删除，请重新确认后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PracticeShell current="设置">
      <div className="account-data-rights-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">DATA RIGHTS</p>
            <h1>导出与永久删除</h1>
          </div>
          <p>取得完整账号数据，或发起不可撤销的账号删除。</p>
        </header>
        <nav aria-label="账号设置" className="account-settings-nav">
          <a href="/settings/account">账号与额度</a>
          <a href="/settings/devices">扩展设备</a>
          <a aria-current="page" href="/settings/data">
            数据权利
          </a>
        </nav>
        <p aria-atomic="true" aria-live="polite" role="status">
          {message}
        </p>
        {error !== "" && <p role="alert">{error}</p>}
        {loadState === "loading" && <p role="status">正在载入数据权利状态…</p>}
        {loadState === "error" && (
          <button onClick={() => void load()} type="button">
            重新载入
          </button>
        )}
        {loadState === "ready" && (
          <section className="data-export-card">
            <h2>完整数据导出</h2>
            <p>包含账号偏好、分析、学习项与排期、生词语境和正式练习。</p>
            <p>不包含密码、第三方凭据、会话、内部安全记录或隐藏模型内容。</p>
            {job === null ? (
              <div className="empty-state">
                <h3>尚未请求完整数据导出</h3>
                <button
                  data-create-export
                  disabled={busy}
                  onClick={() => void createExport()}
                  type="button"
                >
                  请求完整数据导出
                </button>
              </div>
            ) : (
              <div className={`export-state export-state-${job.state}`}>
                <h3>{status(job)}</h3>
                <p>
                  格式版本：v{job.formatVersion}；任务版本：{job.revision}
                </p>
                {job.state === "ready" && (
                  <button
                    data-download-export
                    disabled={busy}
                    onClick={() => void download()}
                    type="button"
                  >
                    取得 15 分钟下载地址
                  </button>
                )}
                {job.state === "failed" && (
                  <button disabled={busy} onClick={() => void retryExport()} type="button">
                    重试生成
                  </button>
                )}
                {job.state === "expired" && (
                  <button disabled={busy} onClick={() => void createExport()} type="button">
                    请求新的导出
                  </button>
                )}
              </div>
            )}
          </section>
        )}
        <section aria-labelledby="delete-account-heading" className="danger-zone">
          <h2 id="delete-account-heading">永久删除账号</h2>
          <p>
            这会退出所有 Web
            与扩展设备，并永久删除语见云端数据及登录身份；外部词典已有副本不会被远程删除。
          </p>
          <label>
            <input
              checked={understood}
              name="understood"
              onChange={(event) => setUnderstood(event.currentTarget.checked)}
              type="checkbox"
            />
            我理解删除不可撤销，并已自行保存所需数据
          </label>
          <label htmlFor="confirmation-phrase">输入“删除我的账号”以继续</label>
          <input
            autoComplete="off"
            id="confirmation-phrase"
            name="confirmationPhrase"
            onChange={(event) => setConfirmationPhrase(event.currentTarget.value)}
            value={confirmationPhrase}
          />
          <button
            data-prepare-deletion
            disabled={busy || !understood || confirmationPhrase !== "删除我的账号"}
            onClick={() => setConfirming(true)}
            type="button"
          >
            进入最终确认
          </button>
          {confirming && (
            <div aria-labelledby="final-confirmation-heading" className="deletion-confirmation">
              <h3 id="final-confirmation-heading">最后确认</h3>
              <p>提交后立即退出，删除任务不能撤销。</p>
              <button
                data-confirm-deletion
                disabled={busy}
                onClick={() => void deleteAccount()}
                ref={confirmButton}
                type="button"
              >
                永久删除我的账号
              </button>
              <button disabled={busy} onClick={() => setConfirming(false)} type="button">
                取消
              </button>
            </div>
          )}
        </section>
      </div>
    </PracticeShell>
  );
}

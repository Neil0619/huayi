import { useEffect, useRef, useState, type FormEvent } from "react";

import type { WebIdentityApi } from "./identity-api.js";
import type { PasswordRecoveryRoute } from "./password-recovery-route.js";

export type PasswordRecoveryApi = Pick<
  WebIdentityApi,
  "completePasswordRecovery" | "getPasswordRecoverySession" | "requestPasswordRecovery"
>;

type RecoveryView = "complete" | "failed" | "loading" | "request" | "success";

export function PasswordRecoveryPage({
  api,
  onCompleted,
  replaceRecoveryUrl,
  route,
}: {
  readonly api: PasswordRecoveryApi;
  readonly onCompleted: () => void;
  readonly replaceRecoveryUrl: () => void;
  readonly route: PasswordRecoveryRoute;
}) {
  const [view, setView] = useState<RecoveryView>(route.continuation ? "loading" : "request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const sessionRequested = useRef(false);
  const urlCleared = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (route.clearUrl && !urlCleared.current) {
      urlCleared.current = true;
      replaceRecoveryUrl();
    }
    if (!route.continuation || sessionRequested.current) return;
    sessionRequested.current = true;
    void api
      .getPasswordRecoverySession()
      .then((session) => {
        setCsrfToken(session.csrfToken);
        setView("complete");
      })
      .catch(() => {
        setError("恢复链接无效或已过期。请重新发起密码恢复。");
        setView("failed");
      });
  }, [api, replaceRecoveryUrl, route.clearUrl, route.continuation]);

  useEffect(() => {
    if (view === "complete" || view === "failed" || view === "success") {
      heading.current?.focus();
    }
  }, [view]);

  const requestRecovery = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await api.requestPasswordRecovery(email);
      setEmail("");
      setStatus("如果该邮箱可恢复，我们已发送邮件。请在邮件中确认后继续。");
    } catch {
      setError("暂时无法提交密码恢复请求。请检查邮箱或稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  const completeRecovery = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    if (password !== confirmation) {
      setError("两次输入的密码不一致，请重新确认。");
      return;
    }
    if (password.length < 12 || password.length > 256 || csrfToken === null) {
      setError("新密码必须为 12 至 256 个字符。");
      return;
    }
    setBusy(true);
    try {
      await api.completePasswordRecovery(password, csrfToken);
      setPassword("");
      setConfirmation("");
      setCsrfToken(null);
      setStatus("密码已更新。请使用新密码重新登录。");
      setView("success");
      onCompleted();
    } catch {
      setError("无法完成密码恢复。请检查输入，或重新发起恢复后再试。");
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setCsrfToken(null);
    setPassword("");
    setConfirmation("");
    setError(null);
    setStatus(null);
    setView("request");
  };

  const title = view === "complete" ? "设置新密码" : view === "success" ? "密码已更新" : "恢复密码";
  const errorDescription = error === null ? undefined : "password-recovery-error";

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-card" aria-labelledby="password-recovery-heading">
        <span aria-hidden="true" className="brand-mark" />
        <p className="eyebrow">HUAYI CLOUD</p>
        <h1
          id="password-recovery-heading"
          ref={heading}
          tabIndex={view === "complete" || view === "failed" || view === "success" ? -1 : undefined}
        >
          {title}
        </h1>
        {error !== null && (
          <div className="alert" id="password-recovery-error" role="alert">
            <p>{error}</p>
          </div>
        )}
        {status !== null && (
          <p aria-live="polite" className="auth-status" role="status">
            {status}
          </p>
        )}
        {view === "loading" && (
          <p aria-live="polite" role="status">
            正在验证恢复链接…
          </p>
        )}
        {view === "request" && (
          <>
            <p className="auth-intro">输入账号邮箱。无论账号是否可恢复，页面都会显示相同结果。</p>
            <form className="auth-form" onSubmit={(event) => void requestRecovery(event)}>
              <label htmlFor="recovery-email">邮箱</label>
              <input
                aria-describedby={errorDescription}
                autoComplete="email"
                id="recovery-email"
                onChange={(event) => setEmail(event.currentTarget.value)}
                required
                type="email"
                value={email}
              />
              <button
                className="primary-button"
                data-request-recovery
                disabled={busy}
                type="submit"
              >
                {busy ? "正在提交…" : "发送恢复邮件"}
              </button>
            </form>
          </>
        )}
        {view === "complete" && (
          <form className="auth-form" onSubmit={(event) => void completeRecovery(event)}>
            <label htmlFor="recovery-password">新密码</label>
            <input
              aria-describedby={errorDescription ?? "recovery-password-help"}
              autoComplete="new-password"
              id="recovery-password"
              maxLength={256}
              minLength={12}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              type="password"
              value={password}
            />
            <label htmlFor="recovery-password-confirmation">再次输入新密码</label>
            <input
              aria-describedby={errorDescription ?? "recovery-password-help"}
              autoComplete="new-password"
              id="recovery-password-confirmation"
              maxLength={256}
              minLength={12}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              required
              type="password"
              value={confirmation}
            />
            <p className="field-help" id="recovery-password-help">
              请输入 12 至 256 个字符；两次输入必须完全相同。
            </p>
            <button className="primary-button" data-complete-recovery disabled={busy} type="submit">
              {busy ? "正在更新…" : "更新密码"}
            </button>
          </form>
        )}
        {view === "failed" && (
          <button className="primary-button" data-restart-recovery onClick={restart} type="button">
            重新发起密码恢复
          </button>
        )}
        <p className="auth-footer">
          <a href="/login">返回登录</a>
        </p>
        <p className="auth-footer">
          <a href="/privacy">隐私说明</a>
        </p>
      </section>
    </main>
  );
}

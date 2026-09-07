import { useEffect, useRef, useState, type FormEvent } from "react";

import { WebIdentityApiError, type WebIdentityApi } from "./identity-api.js";
import type { PasswordRecoveryRoute } from "./password-recovery-route.js";

export type PasswordRecoveryApi = Pick<
  WebIdentityApi,
  "completePasswordRecovery" | "getPasswordRecoverySession" | "requestPasswordRecovery"
>;

type RecoveryView = "complete" | "failed" | "loading" | "request" | "sent" | "success";
const resendDelaySeconds = 120;

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
  const [resendAt, setResendAt] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const requestEmail = useRef("");
  const mutationPending = useRef(false);
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
    if (view !== "request" && view !== "loading") {
      heading.current?.focus();
    }
  }, [view]);

  useEffect(() => {
    if (resendAt === 0) return;
    const update = () =>
      setRemainingSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const startResendDelay = () => {
    setResendAt(Date.now() + resendDelaySeconds * 1000);
    setRemainingSeconds(resendDelaySeconds);
  };

  const requestRecovery = async (resend = false) => {
    if (
      mutationPending.current ||
      (resend && (Date.now() < resendAt || requestEmail.current === ""))
    )
      return;
    mutationPending.current = true;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const submittedEmail = resend ? requestEmail.current : email;
      await api.requestPasswordRecovery(submittedEmail);
      requestEmail.current = submittedEmail;
      setEmail("");
      startResendDelay();
      setStatus(
        "恢复请求已提交。如果该邮箱可以恢复，邮件通常会在几分钟内到达。请前往邮箱查看，也请检查垃圾邮件。",
      );
      setView("sent");
    } catch (failure) {
      if (failure instanceof WebIdentityApiError && failure.code === "rate_limited") {
        startResendDelay();
        setError("恢复请求过于频繁。请先检查已收到的邮件，稍后再试；每小时最多可提交 3 次。");
      } else {
        setError(
          resend
            ? "暂时无法重新发送。请先查看之前的邮件，稍后再试。"
            : "暂时无法提交密码恢复请求，请稍后重试。",
        );
      }
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  };

  const completeRecovery = async (event: FormEvent) => {
    event.preventDefault();
    if (mutationPending.current) return;
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
    mutationPending.current = true;
    setBusy(true);
    try {
      await api.completePasswordRecovery(password, csrfToken);
      setPassword("");
      setConfirmation("");
      setCsrfToken(null);
      setStatus("密码已更新。请使用新密码重新登录。");
      setView("success");
      onCompleted();
    } catch (failure) {
      setError(
        failure instanceof WebIdentityApiError && failure.code === "invalid_request"
          ? "新密码不符合要求。请输入与当前密码不同的密码，并满足密码长度要求，然后重新提交。"
          : "无法完成密码恢复。请确认新密码与当前密码不同并稍后重试；若链接已打开较久，请重新发起恢复。",
      );
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  };

  const restart = () => {
    setCsrfToken(null);
    setPassword("");
    setConfirmation("");
    setError(null);
    setStatus(null);
    requestEmail.current = "";
    setView("request");
  };

  const title =
    view === "complete"
      ? "设置新密码"
      : view === "success"
        ? "密码已更新"
        : view === "sent"
          ? "请查收恢复邮件"
          : "恢复密码";
  const errorDescription = error === null ? undefined : "password-recovery-error";

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-card" aria-labelledby="password-recovery-heading">
        <span aria-hidden="true" className="brand-mark" />
        <p className="eyebrow">SEEN & SAID</p>
        <h1
          id="password-recovery-heading"
          ref={heading}
          tabIndex={view !== "request" && view !== "loading" ? -1 : undefined}
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
            <p className="auth-intro">
              输入登录邮箱。为保护账号，无论邮箱是否存在，页面都会显示相同结果。
            </p>
            <form
              className="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                void requestRecovery();
              }}
            >
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
                disabled={busy || remainingSeconds > 0}
                type="submit"
              >
                {busy
                  ? "正在提交…"
                  : remainingSeconds > 0
                    ? `${remainingSeconds} 秒后可重试`
                    : "发送恢复邮件"}
              </button>
            </form>
          </>
        )}
        {view === "sent" && (
          <div className="auth-form">
            <p className="field-help">
              请耐心等待。重新发送后，之前邮件中的恢复链接将失效，请使用最新一封邮件。
            </p>
            <a className="primary-button" href="/login">
              返回登录
            </a>
            <button
              data-resend-recovery
              disabled={busy || remainingSeconds > 0}
              onClick={() => void requestRecovery(true)}
              type="button"
            >
              {busy
                ? "正在重新提交…"
                : remainingSeconds > 0
                  ? `${remainingSeconds} 秒后可重新发送`
                  : "重新发送恢复邮件"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const previousEmail = requestEmail.current;
                restart();
                setEmail(previousEmail);
              }}
              type="button"
            >
              修改邮箱
            </button>
          </div>
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
              onChange={(event) => {
                setPassword(event.currentTarget.value);
                setError(null);
              }}
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
              onChange={(event) => {
                setConfirmation(event.currentTarget.value);
                setError(null);
              }}
              required
              type="password"
              value={confirmation}
            />
            <p className="field-help" id="recovery-password-help">
              请输入 12 至 256 个字符，且不能与当前密码相同；两次输入必须完全相同。
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
        <nav aria-label="密码恢复辅助链接" className="auth-footer password-recovery-footer">
          {view !== "sent" && <a href="/login">返回登录</a>}
          <a href="/privacy">隐私说明</a>
        </nav>
      </section>
    </main>
  );
}

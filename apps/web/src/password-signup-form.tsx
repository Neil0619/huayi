import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PasswordSignupSession } from "@huayi/cloud-contracts";

import { WebIdentityApiError } from "./identity-api.js";
import type { PasswordSignupApi } from "./password-signup-api.js";

type Step = "email" | "verify-email" | "set-password" | "loading" | "expired" | "complete";
const steps = ["填写邮箱", "验证邮箱", "设置密码"];

export function PasswordSignupForm({
  api,
  claimTicket,
  onAuthenticated,
  onStarted,
}: {
  readonly api: PasswordSignupApi;
  readonly claimTicket: string | null;
  readonly onAuthenticated: (access: "data-rights" | "full") => void;
  readonly onStarted?: () => void;
}) {
  const [step, setStep] = useState<Step>(claimTicket === null ? "loading" : "email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inFlight = useRef(false);
  const initialized = useRef(claimTicket !== null);
  const heading = useRef<HTMLHeadingElement>(null);

  const accept = (session: PasswordSignupSession) => {
    setEmail(session.email);
    setCsrfToken(session.csrfToken);
    setStep(session.step);
  };
  const restore = async () => {
    try {
      accept(await api.getPasswordSignupSession());
      setError(null);
    } catch (cause) {
      setStep("expired");
      setError(
        cause instanceof WebIdentityApiError && cause.status === 409
          ? "注册操作仍在处理中。请稍后点击继续注册。"
          : "未找到有效的注册进度。请回到发起注册的浏览器，或使用原邀请链接继续。",
      );
    }
  };
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      void restore();
    }
  });
  useEffect(() => {
    if (step !== "email" && step !== "loading") heading.current?.focus();
  }, [step]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await run(async () => {
      try {
        if (step === "email" && claimTicket !== null) {
          accept(await api.startPasswordSignup(claimTicket, email));
          setStatus("验证码已发送，请输入邮件中的六位验证码。");
          setCooldown(60);
          onStarted?.();
        } else if (step === "verify-email" && csrfToken !== null) {
          if (!/^\d{6}$/u.test(otp)) {
            setError("请输入六位数字验证码。");
            return;
          }
          accept(await api.verifyPasswordSignup(otp, csrfToken));
          setOtp("");
          setStatus("邮箱验证成功。请设置登录密码。");
        } else if (step === "set-password" && csrfToken !== null) {
          if (password !== confirmation) {
            setError("两次输入的密码不一致，请重新确认。");
            return;
          }
          if (password.length < 12 || password.length > 256) {
            setError("密码需要 12 至 256 个字符。");
            return;
          }
          const session = await api.completePasswordSignup(password, csrfToken);
          setPassword("");
          setConfirmation("");
          setCsrfToken(null);
          setStep("complete");
          setStatus("注册完成，正在进入工作台。");
          onAuthenticated(session.access);
        }
      } catch (cause) {
        const limited = cause instanceof WebIdentityApiError && cause.status === 429;
        setError(
          limited
            ? "操作较频繁，请稍后重试。"
            : step === "verify-email"
              ? "验证码无效或已过期。请检查最新邮件中的验证码后重试。"
              : step === "set-password"
                ? "暂时无法完成注册，请使用刚才填写的密码重试。如果已完成注册，可直接登录。"
                : "暂时无法发送验证码。请检查邮箱后重试；如果请求已提交，可点击继续注册。",
        );
      }
    });
  };
  const resend = () =>
    run(async () => {
      if (csrfToken === null || cooldown > 0) return;
      try {
        await api.resendPasswordSignup(csrfToken);
        setOtp("");
        setCooldown(60);
        setStatus("新的六位验证码已发送。请只使用最新邮件中的验证码。");
      } catch {
        setError("暂时无法重新发送验证码，请稍后重试。");
      }
    });
  const active = step === "email" ? 0 : step === "verify-email" ? 1 : 2;
  const errorDescription = error === null ? undefined : "signup-error";

  return (
    <div className="password-signup">
      {step !== "loading" && step !== "expired" && (
        <ol aria-label="注册步骤" className="auth-steps">
          {steps.map((label, index) => (
            <li aria-current={index === active ? "step" : undefined} key={label}>
              <span aria-hidden="true">{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      )}
      <h2 className="auth-step-title" ref={heading} tabIndex={-1}>
        {step === "email"
          ? "先验证你的邮箱"
          : step === "verify-email"
            ? "输入验证码"
            : step === "set-password"
              ? "设置登录密码"
              : step === "loading"
                ? "正在恢复注册进度…"
                : step === "complete"
                  ? "注册完成"
                  : "继续注册"}
      </h2>
      {error !== null && (
        <p className="alert" id="signup-error" role="alert">
          {error}
        </p>
      )}
      {status !== null && (
        <p className="auth-status" role="status">
          {status}
        </p>
      )}
      {(step === "verify-email" || step === "set-password") && (
        <p className="auth-signup-email">
          {step === "verify-email" ? "验证码已发送至" : "已验证邮箱"}
          <strong>{email}</strong>
        </p>
      )}
      {step === "email" && <p className="field-help">验证成功后，再设置登录密码。</p>}
      {(step === "email" || step === "verify-email" || step === "set-password") && (
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {step === "email" && (
            <>
              <label htmlFor="registration-email">邮箱</label>
              <input
                aria-describedby={errorDescription}
                autoComplete="email"
                disabled={busy}
                id="registration-email"
                maxLength={320}
                onChange={(event) => setEmail(event.currentTarget.value)}
                required
                type="email"
                value={email}
              />
            </>
          )}
          {step === "verify-email" && (
            <>
              <label htmlFor="registration-otp">六位验证码</label>
              <input
                aria-describedby={errorDescription ?? "registration-otp-help"}
                autoComplete="one-time-code"
                disabled={busy}
                id="registration-otp"
                inputMode="numeric"
                maxLength={6}
                minLength={6}
                onChange={(event) => setOtp(event.currentTarget.value.replace(/\s/gu, ""))}
                pattern="[0-9]{6}"
                required
                type="text"
                value={otp}
              />
              <p className="field-help" id="registration-otp-help">
                在这里输入验证码即可，无需打开邮件中的链接。
              </p>
            </>
          )}
          {step === "set-password" && (
            <>
              <label htmlFor="registration-password">密码</label>
              <input
                aria-describedby={errorDescription ?? "registration-password-help"}
                autoComplete="new-password"
                disabled={busy}
                id="registration-password"
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
              <label htmlFor="registration-password-confirmation">确认密码</label>
              <input
                aria-describedby={errorDescription ?? "registration-password-help"}
                autoComplete="new-password"
                disabled={busy}
                id="registration-password-confirmation"
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
              <p className="field-help" id="registration-password-help">
                12 至 256 个字符，两次输入需保持一致。
              </p>
            </>
          )}
          <button
            className="primary-button"
            data-register={step === "email" ? "" : undefined}
            disabled={busy}
            type="submit"
          >
            {busy
              ? "正在处理…"
              : step === "email"
                ? "发送验证码"
                : step === "verify-email"
                  ? "验证邮箱"
                  : "完成注册"}
          </button>
        </form>
      )}
      {step === "verify-email" && (
        <button
          className="auth-resend"
          data-resend-signup
          disabled={busy || cooldown > 0}
          onClick={() => void resend()}
          type="button"
        >
          {cooldown > 0 ? `${cooldown} 秒后可重新发送` : "重新发送验证码"}
        </button>
      )}
      {(step === "expired" || (step === "email" && error !== null)) && (
        <button disabled={busy} onClick={() => void run(restore)} type="button">
          继续注册
        </button>
      )}
    </div>
  );
}

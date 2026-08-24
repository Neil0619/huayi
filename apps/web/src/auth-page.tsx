import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { WebIdentityApi } from "./identity-api.js";

export type AuthApi = Pick<
  WebIdentityApi,
  | "claimInvitation"
  | "googleAuthStartUrl"
  | "googleLoginStartUrl"
  | "loginPassword"
  | "registerPassword"
  | "resendPasswordRegistration"
  | "resumePasswordRegistration"
>;

export type AuthRoute =
  { readonly invitationToken: string; readonly mode: "join" } | { readonly mode: "login" };

type AuthPageProps = {
  readonly api: AuthApi;
  readonly googleAuthenticationEnabled: boolean;
  readonly onAuthenticated: (access: "data-rights" | "full") => void;
  readonly replaceInvitationUrl: () => void;
} & AuthRoute;

type ClaimState = "error" | "idle" | "loading" | "ready";

export function AuthPage(props: AuthPageProps) {
  const [claimState, setClaimState] = useState<ClaimState>(
    props.mode === "join" ? "loading" : "idle",
  );
  const [claimTicket, setClaimTicket] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [emailConfirmationPending, setEmailConfirmationPending] = useState(false);
  const invitationToken = useRef(props.mode === "join" ? props.invitationToken : null);
  const claimInFlight = useRef(false);

  const claim = useCallback(async () => {
    const token = invitationToken.current;
    if (token === null || claimInFlight.current) return;
    claimInFlight.current = true;
    setClaimState("loading");
    setError(null);
    try {
      const result = await props.api.claimInvitation(token);
      props.replaceInvitationUrl();
      setClaimTicket(result.claimTicket);
      setClaimState("ready");
    } catch {
      setClaimState("error");
      setError("邀请验证失败。邀请可能已过期、被撤销或已经使用，请确认链接后重试。");
    } finally {
      claimInFlight.current = false;
    }
  }, [props.api, props.replaceInvitationUrl]);

  useEffect(() => {
    if (props.mode === "join") void claim();
  }, [claim, props.mode]);

  const register = async (event: FormEvent) => {
    event.preventDefault();
    if (claimTicket === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await props.api.registerPassword(claimTicket, email, password);
      setPassword("");
      setClaimTicket(null);
      if (result.emailConfirmationRequired) {
        setEmailConfirmationPending(true);
        setStatus("注册已提交。请从验证邮件打开确认页，并输入邮件中的六位验证码。");
      } else {
        invitationToken.current = null;
        setStatus("注册成功，正在进入工作台。");
        props.onAuthenticated("full");
      }
    } catch {
      setError("注册失败，当前邮箱仍已保留。请检查输入或稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  const resendRegistration = async () => {
    const token = invitationToken.current;
    if (token === null) return;
    setBusy(true);
    setError(null);
    try {
      await props.api.resendPasswordRegistration(token);
      setEmailConfirmationPending(true);
      setStatus("新的六位验证码已发送。请只使用最新邮件中的验证码。");
    } catch {
      setError("无法重新发送验证码。请稍后重试，并确认仍在使用原私密邀请。");
    } finally {
      setBusy(false);
    }
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await props.api.loginPassword(email, password);
      setPassword("");
      setStatus("登录成功，正在进入工作台。");
      props.onAuthenticated(session.access);
    } catch {
      setError("登录失败。请检查邮箱和密码后重试。");
    } finally {
      setBusy(false);
    }
  };

  const resumeRegistration = async () => {
    const token = invitationToken.current;
    if (token === null || claimState !== "error") return;
    setBusy(true);
    setError(null);
    try {
      const session = await props.api.resumePasswordRegistration(token, email, password);
      if (session.emailConfirmationRequired) {
        throw new Error("Interrupted registration did not complete.");
      }
      setPassword("");
      invitationToken.current = null;
      props.replaceInvitationUrl();
      setStatus("邮箱已确认，邀请已完成，正在进入工作台。");
      props.onAuthenticated(session.access);
    } catch {
      setError("无法继续完成邀请。请确认邮箱、密码和私密邀请仍然有效后重试。");
    } finally {
      setBusy(false);
    }
  };

  const errorDescription = error === null ? undefined : "auth-form-error";

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-card" aria-labelledby="auth-heading">
        <span aria-hidden="true" className="brand-mark" />
        <p className="eyebrow">SEEN & SAID</p>
        <h1 id="auth-heading">{props.mode === "join" ? "接受学习邀请" : "登录语见"}</h1>
        <p className="auth-intro" lang="en">
          Turn what you see into what you can say.
        </p>
        {error !== null && (
          <div className="alert" id="auth-form-error" role="alert">
            <p>{error}</p>
            {claimState === "error" && (
              <>
                <button data-retry-invitation onClick={() => void claim()} type="button">
                  重新验证邀请
                </button>
                <button
                  data-resend-registration
                  disabled={busy}
                  onClick={() => void resendRegistration()}
                  type="button"
                >
                  {busy ? "正在发送…" : "重新发送六位验证码"}
                </button>
                <p>如果你已经点击过确认邮件，可使用原邮箱和密码继续这次中断的注册。</p>
                <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
                  <label htmlFor="recovery-registration-email">邮箱</label>
                  <input
                    autoComplete="email"
                    id="recovery-registration-email"
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    required
                    type="email"
                    value={email}
                  />
                  <label htmlFor="recovery-registration-password">密码</label>
                  <input
                    autoComplete="current-password"
                    id="recovery-registration-password"
                    minLength={12}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    required
                    type="password"
                    value={password}
                  />
                  <button
                    data-resume-registration
                    disabled={busy}
                    onClick={() => void resumeRegistration()}
                    type="button"
                  >
                    {busy ? "正在恢复…" : "继续中断注册"}
                  </button>
                </form>
              </>
            )}
          </div>
        )}
        {status !== null && (
          <p aria-live="polite" className="auth-status" role="status">
            {status}
          </p>
        )}
        {emailConfirmationPending && claimState !== "error" && (
          <button
            data-resend-registration
            disabled={busy}
            onClick={() => void resendRegistration()}
            type="button"
          >
            {busy ? "正在发送…" : "重新发送六位验证码"}
          </button>
        )}
        {props.mode === "join" && claimState === "loading" && (
          <p aria-live="polite" role="status">
            正在验证邀请…
          </p>
        )}
        {props.mode === "join" && claimState === "ready" && claimTicket !== null && (
          <>
            <p className="auth-intro">
              {props.googleAuthenticationEnabled
                ? "邀请已验证。选择一种方式创建账号。"
                : "邀请已验证。使用邮箱创建账号。"}
            </p>
            {props.googleAuthenticationEnabled && (
              <>
                <form
                  acceptCharset="UTF-8"
                  action={props.api.googleAuthStartUrl}
                  data-google-auth-form
                  method="post"
                >
                  <input name="claimTicket" type="hidden" value={claimTicket} />
                  <button className="primary-button" type="submit">
                    使用 Google 继续
                  </button>
                </form>
                <div aria-hidden="true" className="auth-divider">
                  或使用邮箱
                </div>
              </>
            )}
            <form className="auth-form" onSubmit={(event) => void register(event)}>
              <label htmlFor="registration-email">邮箱</label>
              <input
                aria-describedby={errorDescription}
                autoComplete="email"
                id="registration-email"
                onChange={(event) => setEmail(event.currentTarget.value)}
                required
                type="email"
                value={email}
              />
              <label htmlFor="registration-password">密码</label>
              <input
                aria-describedby="registration-password-help"
                autoComplete="new-password"
                id="registration-password"
                minLength={12}
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
                type="password"
                value={password}
              />
              <p className="field-help" id="registration-password-help">
                至少 12 个字符。密码只发送到固定 API，不由 Web 保存。
              </p>
              <button className="primary-button" data-register disabled={busy} type="submit">
                {busy ? "正在注册…" : "使用邮箱注册"}
              </button>
            </form>
          </>
        )}
        {props.mode === "login" && (
          <>
            <p className="auth-intro">
              {props.googleAuthenticationEnabled
                ? "已注册用户可使用 Google 或邮箱密码登录。"
                : "已注册用户使用邮箱密码登录。"}
            </p>
            {props.googleAuthenticationEnabled && (
              <>
                <form action={props.api.googleLoginStartUrl} method="post">
                  <button className="primary-button" type="submit">
                    使用 Google 登录
                  </button>
                </form>
                <div aria-hidden="true" className="auth-divider">
                  或使用邮箱
                </div>
              </>
            )}
            <form className="auth-form" onSubmit={(event) => void login(event)}>
              <label htmlFor="login-email">邮箱</label>
              <input
                aria-describedby={errorDescription}
                autoComplete="email"
                id="login-email"
                onChange={(event) => setEmail(event.currentTarget.value)}
                required
                type="email"
                value={email}
              />
              <label htmlFor="login-password">密码</label>
              <input
                aria-describedby={errorDescription}
                autoComplete="current-password"
                id="login-password"
                minLength={12}
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
                type="password"
                value={password}
              />
              <button className="primary-button" data-login disabled={busy} type="submit">
                {busy ? "正在登录…" : "登录"}
              </button>
            </form>
            <p className="auth-footer">
              <a href="/recover">忘记密码？</a>
            </p>
          </>
        )}
        <p className="auth-footer">
          {props.mode === "join" ? (
            <a href="/login">已有账号？直接登录</a>
          ) : (
            "新账号只能通过有效邀请创建。"
          )}
        </p>
        <p className="auth-footer">
          <a href="/privacy">隐私说明</a>
        </p>
      </section>
    </main>
  );
}

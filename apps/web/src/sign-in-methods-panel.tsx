import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { AccountSignInMethodsResponse, SignInMethod } from "@huayi/cloud-contracts";

import { WebIdentityApiError, type WebIdentityApi } from "./identity-api.js";

export type SignInMethodsApi = Pick<
  WebIdentityApi,
  | "bootstrap"
  | "getAccountSignInMethods"
  | "linkPassword"
  | "reauthenticatePassword"
  | "startGoogleLink"
  | "startGoogleReauthentication"
>;

type LoadState = "error" | "loading" | "ready";

const methodLabels: Record<SignInMethod, string> = {
  google: "Google 已绑定",
  password: "密码已绑定",
};

function linkedDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function SignInMethodsPanel({
  api,
  csrfToken,
  navigate = (url) => window.location.assign(url),
  onCsrfTokenChanged,
}: {
  readonly api: SignInMethodsApi;
  readonly csrfToken: string;
  readonly navigate?: (url: string) => void;
  readonly onCsrfTokenChanged: (csrfToken: string) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const [googleFormOpen, setGoogleFormOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [methods, setMethods] = useState<AccountSignInMethodsResponse | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setError("");
    setLoadState("loading");
    try {
      const result = await api.getAccountSignInMethods();
      if (current !== generation.current) return;
      setMethods(result);
      setLoadState("ready");
    } catch {
      if (current !== generation.current) return;
      setError("无法载入登录方式，请检查网络后重试。");
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

  const hasMethod = (method: SignInMethod) =>
    methods?.methods.some((candidate) => candidate.method === method) ?? false;

  const recoverAlreadyLinked = async (errorValue: unknown, method: SignInMethod) => {
    if (
      !(errorValue instanceof WebIdentityApiError) ||
      errorValue.code !== "sign_in_method_already_linked"
    ) {
      return false;
    }
    const refreshedMethods = await api.getAccountSignInMethods();
    if (!refreshedMethods.methods.some((candidate) => candidate.method === method)) return false;
    setMethods(refreshedMethods);
    setCurrentPassword("");
    setNewPassword("");
    setStatus(`${method === "google" ? "Google" : "密码"}登录方式已经绑定，页面已刷新。`);
    return true;
  };

  const addGoogle = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setSaving(true);
    try {
      const reauthenticated = await api.reauthenticatePassword(currentPassword, csrfToken);
      onCsrfTokenChanged(reauthenticated.csrfToken);
      const link = await api.startGoogleLink(reauthenticated.csrfToken);
      navigate(link.continueUrl);
    } catch (errorValue) {
      try {
        if (await recoverAlreadyLinked(errorValue, "google")) return;
      } catch {
        // Fall through to the fixed retryable error when the authoritative reread fails.
      }
      setError("暂时无法完成 Google 绑定。密码已保留，请检查后重试。");
    } finally {
      setSaving(false);
    }
  };

  const reauthenticateGoogle = async () => {
    setError("");
    setStatus("");
    setSaving(true);
    try {
      const result = await api.startGoogleReauthentication(csrfToken);
      navigate(result.continueUrl);
    } catch {
      setError("暂时无法开始 Google 身份确认，请稍后重试。");
      setSaving(false);
    }
  };

  const addPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setSaving(true);
    try {
      await api.linkPassword(newPassword, csrfToken);
      const [bootstrap, refreshedMethods] = await Promise.all([
        api.bootstrap(),
        api.getAccountSignInMethods(),
      ]);
      onCsrfTokenChanged(bootstrap.csrfToken);
      setMethods(refreshedMethods);
      setNewPassword("");
      setStatus("密码登录方式已绑定，其他会话已退出。");
    } catch (errorValue) {
      try {
        if (await recoverAlreadyLinked(errorValue, "password")) return;
      } catch {
        // Fall through to the fixed retryable error when the authoritative reread fails.
      }
      setError("暂时无法完成密码绑定。密码已保留，请确认 Google 身份后重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="sign-in-methods-heading" className="sign-in-methods-card">
      <h2 id="sign-in-methods-heading">登录方式</h2>
      <p>为当前账号添加备用登录方式。绑定成功会退出其他 Web 与扩展会话。</p>
      {loadState === "loading" && (
        <p aria-live="polite" role="status">
          正在载入登录方式…
        </p>
      )}
      {loadState === "error" && (
        <div className="alert" role="alert">
          <p>{error}</p>
          <button onClick={() => void load()} type="button">
            重新载入
          </button>
        </div>
      )}
      {loadState === "ready" && methods !== null && (
        <>
          <ul className="sign-in-methods-list">
            {methods.methods.map((item) => (
              <li key={item.method}>
                <strong>{methodLabels[item.method]}</strong>
                <span>绑定于 {linkedDate(item.linkedAt)}（UTC）</span>
              </li>
            ))}
          </ul>
          {!hasMethod("google") && (
            <div className="sign-in-method-action">
              <h3>添加 Google 登录</h3>
              <p>先用当前密码确认身份，再前往 Google 完成绑定。</p>
              {!googleFormOpen ? (
                <button data-add-google onClick={() => setGoogleFormOpen(true)} type="button">
                  添加 Google 登录
                </button>
              ) : (
                <form data-google-link-form onSubmit={(event) => void addGoogle(event)}>
                  <label htmlFor="current-password">当前密码</label>
                  <input
                    autoComplete="current-password"
                    disabled={saving}
                    id="current-password"
                    maxLength={256}
                    minLength={12}
                    onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                    required
                    type="password"
                    value={currentPassword}
                  />
                  <div className="form-actions">
                    <button disabled={saving} type="submit">
                      {saving ? "正在继续…" : "确认并前往 Google"}
                    </button>
                    <button
                      disabled={saving}
                      onClick={() => setGoogleFormOpen(false)}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
          {!hasMethod("password") && (
            <div className="sign-in-method-action">
              <h3>添加密码登录</h3>
              <p>先通过 Google 重新确认身份，然后为当前账号设置一个新密码。</p>
              <button
                data-google-reauth
                disabled={saving}
                onClick={() => void reauthenticateGoogle()}
                type="button"
              >
                通过 Google 确认身份
              </button>
              <form data-password-link-form onSubmit={(event) => void addPassword(event)}>
                <label htmlFor="new-password">新密码</label>
                <input
                  aria-describedby="new-password-hint"
                  autoComplete="new-password"
                  disabled={saving}
                  id="new-password"
                  maxLength={256}
                  minLength={12}
                  onChange={(event) => setNewPassword(event.currentTarget.value)}
                  required
                  type="password"
                  value={newPassword}
                />
                <p className="field-hint" id="new-password-hint">
                  至少 12 个字符。密码只会提交给 API，不会显示在状态消息中。
                </p>
                <div className="form-actions">
                  <button disabled={saving} type="submit">
                    {saving ? "正在绑定…" : "绑定密码"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
      {status !== "" && (
        <p aria-live="polite" role="status">
          {status}
        </p>
      )}
      {loadState !== "error" && error !== "" && <p role="alert">{error}</p>}
    </section>
  );
}

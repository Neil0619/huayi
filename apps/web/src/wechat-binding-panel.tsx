import { useState, type FormEvent } from "react";

export function WechatBindingPanel({
  email,
  csrfToken,
  approve,
  reauthenticate,
  onCsrfTokenChanged,
  google,
}: {
  email: string;
  csrfToken: string;
  approve(code: string, csrf: string): Promise<void>;
  reauthenticate(password: string, csrf: string): Promise<{ csrfToken: string }>;
  onCsrfTokenChanged(csrf: string): void;
  google?: ((csrf: string) => Promise<{ continueUrl: string }>) | undefined;
}) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !confirmed) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let csrf = csrfToken;
      if (password) {
        csrf = (await reauthenticate(password, csrfToken)).csrfToken;
        onCsrfTokenChanged(csrf);
        setPassword("");
      }
      await approve(code.trim().toUpperCase(), csrf);
      setCode("");
      setConfirmed(false);
      setMessage("网页确认成功，请返回小程序完成开通。");
    } catch {
      setError(
        "关联未完成。请确认已在 15 分钟内验证身份、绑定码未过期，且两个账号都尚未关联其他身份。输入仍保留。",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="account-summary-card wechat-binding-card"
      aria-labelledby="wechat-binding-heading"
    >
      <h2 id="wechat-binding-heading">微信小程序关联</h2>
      <p>
        在小程序首次开通时选择“关联已有语见账号”，将绑定码输入这里。关联后，小程序可访问 {email}{" "}
        的全部学习数据并共用额度。
      </p>
      <p>此入口仅用于首次开通，不合并两个已有账号。请确认绑定码来自你本人正在使用的小程序。</p>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="wechat-binding-code">小程序一次性绑定码</label>
        <input
          id="wechat-binding-code"
          autoComplete="off"
          value={code}
          maxLength={10}
          pattern="[A-Fa-f0-9]{10}"
          required
          onChange={(event) => setCode(event.currentTarget.value)}
          disabled={busy}
        />
        <label htmlFor="wechat-binding-password">关联验证密码</label>
        <input
          id="wechat-binding-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          disabled={busy}
        />
        <p>已完成近期验证时可留空。Google 账号可先验证 Google 身份，再返回此页填写绑定码并确认。</p>
        {google && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void google(csrfToken)
                .then((result) => window.location.assign(result.continueUrl))
                .catch(() => {
                  setError("无法开始 Google 验证，请稍后重试。");
                  setBusy(false);
                });
            }}
          >
            验证 Google 身份
          </button>
        )}
        <label className="wechat-binding-confirmation">
          <input
            id="wechat-binding-confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
            disabled={busy}
          />
          我确认将该微信身份关联到当前账号，共用学习数据与额度
        </label>
        <button
          data-confirm-wechat
          type="submit"
          disabled={busy || !confirmed || !/^[A-Fa-f0-9]{10}$/u.test(code)}
        >
          {busy ? "正在确认…" : "确认关联"}
        </button>
      </form>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <p role="status">{message}</p>
    </section>
  );
}

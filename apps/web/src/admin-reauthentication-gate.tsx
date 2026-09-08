import { useState, type FormEvent } from "react";

export function AdminReauthenticationGate({
  onReauthenticate,
}: {
  readonly onReauthenticate: (password: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onReauthenticate(password);
      setPassword("");
      setExpanded(false);
      setConfirmed(true);
    } catch {
      setError("密码确认失败，请检查后重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-sensitive-auth" aria-label="敏感操作验证">
      <button
        aria-controls="admin-sensitive-auth-panel"
        aria-expanded={expanded}
        className="admin-sensitive-auth-toggle"
        disabled={saving}
        onClick={() => {
          setExpanded(!expanded);
          setPassword("");
          setError("");
        }}
        type="button"
      >
        验证敏感操作
      </button>
      {confirmed && (
        <p role="status">验证完成，请手动重试需要的操作；结果未知的请求请使用原请求安全恢复。</p>
      )}
      {expanded && (
        <div className="admin-gate" id="admin-sensitive-auth-panel">
          <p>
            浏览控制台无需重复验证。创建邀请、调整账号或额度等敏感操作，要求 15 分钟内的密码确认。
          </p>
          <p>请输入当前登录账号的登录密码。验证不会自动提交或重试操作，密码不会写入浏览器存储。</p>
          {error !== "" && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <form data-admin-reauthentication onSubmit={(event) => void submit(event)}>
            <label htmlFor="admin-current-password">当前账号登录密码</label>
            <input
              autoComplete="current-password"
              autoFocus
              disabled={saving}
              id="admin-current-password"
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              type="password"
              value={password}
            />
            <button disabled={saving} type="submit">
              {saving ? "正在确认…" : "确认敏感操作"}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

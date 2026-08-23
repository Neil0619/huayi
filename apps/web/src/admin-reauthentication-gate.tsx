import { useState, type FormEvent } from "react";

export function AdminReauthenticationGate({
  onReauthenticate,
}: {
  readonly onReauthenticate: (password: string) => Promise<void>;
}) {
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
    } catch {
      setError("密码确认失败，请检查后重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-gate">
      <p className="eyebrow">OPERATOR REAUTHENTICATION</p>
      <h1>重新确认 Operator 身份</h1>
      <p>运营操作要求 15 分钟内的密码确认。密码只用于本次服务器认证，不会写入浏览器存储。</p>
      {error !== "" && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <form data-admin-reauthentication onSubmit={(event) => void submit(event)}>
        <label htmlFor="admin-current-password">当前密码</label>
        <input
          autoComplete="current-password"
          disabled={saving}
          id="admin-current-password"
          onChange={(event) => setPassword(event.currentTarget.value)}
          required
          type="password"
          value={password}
        />
        <button disabled={saving} type="submit">
          {saving ? "正在确认…" : "重新确认并进入"}
        </button>
      </form>
    </section>
  );
}

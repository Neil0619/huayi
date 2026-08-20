import { useState, type FormEvent } from "react";

import type { AccountPreferences, AccountPreferencesRequest } from "@huayi/cloud-contracts";

export interface AccountPreferencesApi {
  updateAccountPreferences(input: AccountPreferencesRequest): Promise<AccountPreferences>;
}

export function AccountPreferencesForm({
  api,
  initialPreferences,
}: {
  readonly api: AccountPreferencesApi;
  readonly initialPreferences: AccountPreferences;
}) {
  const [dailyGoal, setDailyGoal] = useState(String(initialPreferences.dailyGoal));
  const [cloudWordCopyMode, setCloudWordCopyMode] = useState<
    AccountPreferences["cloudWordCopyMode"]
  >(initialPreferences.cloudWordCopyMode);
  const [error, setError] = useState("");
  const [extensionQueryModelMode, setExtensionQueryModelMode] = useState<
    AccountPreferences["extensionQueryModelMode"]
  >(initialPreferences.extensionQueryModelMode);
  const [revision, setRevision] = useState(initialPreferences.revision);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [studyCaptureMode, setStudyCaptureMode] = useState<AccountPreferences["studyCaptureMode"]>(
    initialPreferences.studyCaptureMode,
  );
  const [timezone, setTimezone] = useState(initialPreferences.timezone);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const goal = Number(dailyGoal);
    setError("");
    setStatus("");
    setSaving(true);
    try {
      const saved = await api.updateAccountPreferences({
        cloudWordCopyMode,
        dailyGoal: goal,
        expectedRevision: revision,
        extensionQueryModelMode,
        studyCaptureMode,
        timezone,
      });
      setCloudWordCopyMode(saved.cloudWordCopyMode);
      setDailyGoal(String(saved.dailyGoal));
      setExtensionQueryModelMode(saved.extensionQueryModelMode);
      setRevision(saved.revision);
      setStudyCaptureMode(saved.studyCaptureMode);
      setTimezone(saved.timezone);
      setStatus("账号偏好已保存，并将同步到所有已关联插件。");
    } catch {
      setError("保存失败，草稿已保留；请刷新 revision 或检查输入后重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="preferences-heading" className="account-preferences-card">
      <h2 id="preferences-heading">账号与插件偏好</h2>
      <p>三项插件设置对账号下所有已关联插件生效；不会自动迁移或删除任何本机 BYOK Key。</p>
      <form onSubmit={(event) => void save(event)}>
        <label>
          IANA 时区
          <input
            autoComplete="off"
            maxLength={100}
            name="timezone"
            onChange={(event) => setTimezone(event.currentTarget.value)}
            required
            value={timezone}
          />
        </label>
        <label>
          插件查询模型
          <select
            name="extensionQueryModelMode"
            onChange={(event) =>
              setExtensionQueryModelMode(
                event.currentTarget.value as AccountPreferences["extensionQueryModelMode"],
              )
            }
            value={extensionQueryModelMode}
          >
            <option value="platform">使用 Web 平台额度</option>
            <option value="byok">使用各插件本机 BYOK Key</option>
          </select>
        </label>
        <p className="field-hint">平台模式适合没有模型 Key 的用户；不会自动切换或回退。</p>
        <label>
          查询后加入待学习区
          <select
            name="studyCaptureMode"
            onChange={(event) =>
              setStudyCaptureMode(
                event.currentTarget.value as AccountPreferences["studyCaptureMode"],
              )
            }
            value={studyCaptureMode}
          >
            <option value="manual">手动加入（默认）</option>
            <option value="automatic">自动加入，并允许当前浮层撤销</option>
          </select>
        </label>
        <label>
          云端单词副本
          <select
            name="cloudWordCopyMode"
            onChange={(event) =>
              setCloudWordCopyMode(
                event.currentTarget.value as AccountPreferences["cloudWordCopyMode"],
              )
            }
            value={cloudWordCopyMode}
          >
            <option value="enabled">保存未来新增词的云端副本（默认）</option>
            <option value="disabled">仅保存在各插件本机</option>
          </select>
        </label>
        <p className="field-hint">例如 Asia/Shanghai、Europe/London 或 UTC。</p>
        <label>
          每日目标
          <input
            inputMode="numeric"
            max={100}
            min={1}
            name="dailyGoal"
            onChange={(event) => setDailyGoal(event.currentTarget.value)}
            required
            type="number"
            value={dailyGoal}
          />
        </label>
        <button disabled={saving} type="submit">
          {saving ? "正在保存…" : "保存账号偏好"}
        </button>
      </form>
      {error !== "" && <p role="alert">{error}</p>}
      <p aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}

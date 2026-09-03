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
      setStatus("设置已保存，并将同步到已连接的扩展。");
    } catch {
      setError("保存失败，你刚才的修改已保留。请刷新页面后重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="preferences-heading" className="account-preferences-card">
      <h2 id="preferences-heading">学习与扩展偏好</h2>
      <p>
        这些设置会同步到你已连接的语见扩展，只影响今后的分析和收录；不会改动扩展中已有的模型密钥或生词。
      </p>
      <form onSubmit={(event) => void save(event)}>
        <label>
          所在时区
          <input
            autoComplete="off"
            maxLength={100}
            name="timezone"
            onChange={(event) => setTimezone(event.currentTarget.value)}
            required
            value={timezone}
          />
        </label>
        <p className="field-hint">用于判断“今天”和安排每日练习，例如 Asia/Shanghai。</p>
        <label>
          扩展使用哪种模型
          <select
            name="extensionQueryModelMode"
            onChange={(event) =>
              setExtensionQueryModelMode(
                event.currentTarget.value as AccountPreferences["extensionQueryModelMode"],
              )
            }
            value={extensionQueryModelMode}
          >
            <option value="platform">使用语见提供的模型</option>
            <option value="byok">使用扩展中配置的模型密钥</option>
          </select>
        </label>
        <p className="field-hint">两种方式不会在失败时自动切换。</p>
        <label>
          分析后如何加入待整理
          <select
            name="studyCaptureMode"
            onChange={(event) =>
              setStudyCaptureMode(
                event.currentTarget.value as AccountPreferences["studyCaptureMode"],
              )
            }
            value={studyCaptureMode}
          >
            <option value="manual">由我手动加入（推荐）</option>
            <option value="automatic">自动加入，可在当前结果中撤销</option>
          </select>
        </label>
        <label>
          新收藏的生词是否同步到网页
          <select
            name="cloudWordCopyMode"
            onChange={(event) =>
              setCloudWordCopyMode(
                event.currentTarget.value as AccountPreferences["cloudWordCopyMode"],
              )
            }
            value={cloudWordCopyMode}
          >
            <option value="enabled">同步到语见网页（默认）</option>
            <option value="disabled">只保存在当前扩展</option>
          </select>
        </label>
        <label>
          每日练习目标
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
          {saving ? "正在保存…" : "保存设置"}
        </button>
      </form>
      {error !== "" && <p role="alert">{error}</p>}
      <p aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}

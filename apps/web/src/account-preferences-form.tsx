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
      });
      setCloudWordCopyMode(saved.cloudWordCopyMode);
      setDailyGoal(String(saved.dailyGoal));
      setExtensionQueryModelMode(saved.extensionQueryModelMode);
      setRevision(saved.revision);
      setStudyCaptureMode(saved.studyCaptureMode);
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
        <fieldset className="preferences-group">
          <legend>每日练习</legend>
          <p className="preferences-group-intro">统一按北京时间安排每日练习，每天零点更新。</p>
          <div className="preference-row">
            <div>
              <label htmlFor="preference-daily-goal">每日练习目标</label>
              <p className="field-hint" id="preference-daily-goal-hint">
                每天计划练习的学习项数量。
              </p>
            </div>
            <input
              aria-describedby="preference-daily-goal-hint"
              id="preference-daily-goal"
              inputMode="numeric"
              max={100}
              min={1}
              name="dailyGoal"
              onChange={(event) => setDailyGoal(event.currentTarget.value)}
              required
              type="number"
              value={dailyGoal}
            />
          </div>
        </fieldset>
        <fieldset className="preferences-group">
          <legend>扩展行为</legend>
          <p className="preferences-group-intro">统一应用到这个账号已连接的语见扩展。</p>
          <div className="preference-row">
            <div>
              <label htmlFor="preference-model-mode">扩展使用哪种模型</label>
              <p className="field-hint" id="preference-model-hint">
                两种方式不会在失败时自动切换。
              </p>
            </div>
            <select
              aria-describedby="preference-model-hint"
              id="preference-model-mode"
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
          </div>
          <div className="preference-row">
            <div>
              <label htmlFor="preference-capture-mode">如何加入待整理</label>
              <p className="field-hint" id="preference-capture-hint">
                选择手动收录，或在发起句段查询时自动收录。
              </p>
            </div>
            <select
              aria-describedby="preference-capture-hint"
              id="preference-capture-mode"
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
          </div>
          <div className="preference-row">
            <div>
              <label htmlFor="preference-word-copy">新收藏的生词是否同步到网页</label>
              <p className="field-hint" id="preference-word-hint">
                只影响今后的收藏，已有生词保持不变。
              </p>
            </div>
            <select
              aria-describedby="preference-word-hint"
              id="preference-word-copy"
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
          </div>
        </fieldset>
        <div className="preferences-save-row">
          <button disabled={saving} type="submit">
            {saving ? "正在保存…" : "保存设置"}
          </button>
        </div>
      </form>
      {error !== "" && <p role="alert">{error}</p>}
      <p aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AccountPreferencesRequest,
  AccountResource,
  QuotaSummary,
} from "@huayi/cloud-contracts";

import type { WebIdentityApi } from "./identity-api.js";
import { AccountPreferencesForm } from "./account-preferences-form.js";
import { AccountSettingsLayout } from "./account-settings-layout.js";
import { HelpTip } from "./help-tip.js";
import { SignInMethodsPanel, type SignInMethodsApi } from "./sign-in-methods-panel.js";

export type AccountQuotaApi = Pick<
  WebIdentityApi,
  "getAccount" | "getQuota" | "updateAccountPreferences"
> &
  SignInMethodsApi;
type LoadState = "error" | "loading" | "ready";

function money(microUsd: number): string {
  return new Intl.NumberFormat("zh-CN", {
    currency: "USD",
    minimumFractionDigits: 2,
    style: "currency",
  }).format(microUsd / 1_000_000);
}

function date(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(value),
  );
}

function warning(quota: QuotaSummary): string {
  if (quota.limitMicroUsd === 0) return "尚未配置平台额度。平台模型当前不可用。";
  if (quota.warning === "exhausted") return "平台额度已用完。平台模型当前不可用。";
  if (quota.warning === "warning")
    return `已使用 ${quota.percentUsed.toLocaleString("zh-CN")}%，请留意本月平台额度。`;
  return `已使用 ${quota.percentUsed.toLocaleString("zh-CN")}%，额度状态正常。`;
}

export function AccountQuotaPage({
  api,
  csrfToken,
  googleAuthenticationEnabled = false,
  onCsrfTokenChanged,
  showOperatorNavigation = false,
}: {
  readonly api: AccountQuotaApi;
  readonly csrfToken: string;
  readonly googleAuthenticationEnabled?: boolean | undefined;
  readonly onCsrfTokenChanged: (csrfToken: string) => void;
  readonly showOperatorNavigation?: boolean | undefined;
}) {
  const [error, setError] = useState("");
  const [account, setAccount] = useState<AccountResource | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [quota, setQuota] = useState<QuotaSummary | null>(null);
  const generation = useRef(0);
  const preferencesApi = useMemo(
    () => ({
      updateAccountPreferences: (input: AccountPreferencesRequest) =>
        api.updateAccountPreferences(input, csrfToken),
    }),
    [api, csrfToken],
  );

  const load = useCallback(async () => {
    const current = ++generation.current;
    setError("");
    setLoadState("loading");
    try {
      const [accountResponse, quotaResponse] = await Promise.all([
        api.getAccount(),
        api.getQuota(),
      ]);
      if (current !== generation.current) return;
      setAccount(accountResponse);
      setQuota(quotaResponse);
      setLoadState("ready");
    } catch {
      if (current !== generation.current) return;
      setError("无法载入账号与额度，请检查网络后重试。");
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
  return (
    <AccountSettingsLayout active="account" showOperatorNavigation={showOperatorNavigation}>
      <div className="account-quota-page">
        <header className="page-heading">
          <div>
            <h1>账号与用量</h1>
          </div>
        </header>
        {loadState === "loading" && (
          <p aria-live="polite" role="status">
            正在载入账号额度…
          </p>
        )}
        {loadState === "error" && (
          <div className="alert" role="alert">
            <p>{error}</p>
            <button data-retry-quota onClick={() => void load()} type="button">
              重新载入
            </button>
          </div>
        )}
        {loadState === "ready" && account !== null && quota !== null && (
          <>
            <section aria-labelledby="account-summary-heading" className="account-summary-card">
              <h2 id="account-summary-heading">当前账号</h2>
              <dl>
                <div>
                  <dt>登录邮箱</dt>
                  <dd>{account.email}</dd>
                </div>
                <div>
                  <dt>有效扩展设备</dt>
                  <dd>{account.extensionSessions.length}</dd>
                </div>
                <div>
                  <dt>插件最低版本</dt>
                  <dd>{account.minSupportedExtensionVersion}</dd>
                </div>
              </dl>
            </section>
            <section aria-labelledby="quota-heading" className="quota-card">
              <div className="quota-heading-row">
                <div>
                  <h2 id="quota-heading">本月平台模型额度</h2>
                  <p>
                    本期：{date(quota.periodStart)} 至 {date(quota.periodEnd)}
                    <HelpTip label="额度周期说明">
                      额度按 UTC 月度周期计算，到下期开始时重置。
                    </HelpTip>
                  </p>
                </div>
                <strong className={`quota-badge quota-badge-${quota.warning}`}>
                  {quota.warning === "available"
                    ? "可用"
                    : quota.warning === "warning"
                      ? "请留意"
                      : "已用完"}
                </strong>
              </div>
              <p aria-atomic="true" aria-live="polite" className="quota-warning" role="status">
                {warning(quota)}
              </p>
              <progress
                aria-label={`平台额度已使用 ${quota.percentUsed.toLocaleString("zh-CN")}%`}
                max={100}
                value={quota.percentUsed}
              />
              <dl className="quota-metrics">
                <div>
                  <dt>限额</dt>
                  <dd>{money(quota.limitMicroUsd)}</dd>
                </div>
                <div>
                  <dt>已使用</dt>
                  <dd>{money(quota.usedMicroUsd)}</dd>
                </div>
                <div>
                  <dt>处理中</dt>
                  <dd>{money(quota.reservedMicroUsd)}</dd>
                </div>
                <div>
                  <dt>剩余</dt>
                  <dd>{money(quota.availableMicroUsd)}</dd>
                </div>
              </dl>
              {quota.limitMicroUsd === 0 && (
                <div className="empty-state quota-empty">
                  <h3>尚未配置平台额度</h3>
                  <p>当前账号不能发起平台模型请求，但仍可查看和管理已有学习数据。</p>
                </div>
              )}
              <p className="quota-byok-help">
                自备密钥不计入额度
                <HelpTip label="自备密钥费用说明">
                  插件使用你自己的模型密钥时，费用由对应服务商收取。平台额度用完后，仍可浏览和手动录入内容。
                </HelpTip>
              </p>
            </section>
            <SignInMethodsPanel
              api={api}
              csrfToken={csrfToken}
              googleAuthenticationEnabled={googleAuthenticationEnabled}
              onCsrfTokenChanged={onCsrfTokenChanged}
            />
            <AccountPreferencesForm api={preferencesApi} initialPreferences={account.preferences} />
          </>
        )}
      </div>
    </AccountSettingsLayout>
  );
}

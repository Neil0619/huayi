import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AccountPreferencesRequest,
  AccountResource,
  QuotaSummary,
} from "@huayi/cloud-contracts";

import type { WebIdentityApi } from "./identity-api.js";
import type { WebAdminOperationsApi } from "./admin-operations-api.js";
import { AccountPreferencesForm } from "./account-preferences-form.js";
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
  adminApi,
  csrfToken,
  onCsrfTokenChanged,
}: {
  readonly api: AccountQuotaApi;
  readonly adminApi?: Pick<WebAdminOperationsApi, "access"> | undefined;
  readonly csrfToken: string;
  readonly onCsrfTokenChanged: (csrfToken: string) => void;
}) {
  const [error, setError] = useState("");
  const [account, setAccount] = useState<AccountResource | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [quota, setQuota] = useState<QuotaSummary | null>(null);
  const [operator, setOperator] = useState(false);
  const generation = useRef(0);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
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
  useEffect(() => {
    let active = true;
    void adminApi
      ?.access()
      .then(() => active && setOperator(true))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [adminApi]);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (loadState === "ready") summaryHeading.current?.focus();
  }, [loadState]);

  return (
    <>
      <div className="account-quota-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">ACCOUNT &amp; ALLOWANCE</p>
            <h1>账号与平台额度</h1>
          </div>
          <p>查看服务器计算的当前 UTC 月度平台模型额度。</p>
        </header>
        <nav aria-label="账号设置" className="account-settings-nav">
          <a aria-current="page" href="/settings/account">
            账号与额度
          </a>
          <a href="/settings/devices">扩展设备</a>
          <a href="/settings/data">数据权利</a>
          {operator && <a href="/admin">运营控制台</a>}
        </nav>
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
                  <dt>最低兼容版本</dt>
                  <dd>{account.minSupportedExtensionVersion}</dd>
                </div>
              </dl>
            </section>
            <section aria-labelledby="quota-heading" className="quota-card">
              <div className="quota-heading-row">
                <div>
                  <h2 id="quota-heading" ref={summaryHeading} tabIndex={-1}>
                    本月平台模型额度
                  </h2>
                  <p>
                    UTC 月度周期：{date(quota.periodStart)} 至 {date(quota.periodEnd)}
                    （结束时刻不含）
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
                  <dt>预留中</dt>
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
              <aside className="quota-byok-note">
                <h3>BYOK 不计入平台额度</h3>
                <p>
                  本机 BYOK 不计入上述使用量。即使平台额度用完，BYOK
                  查询仍可继续；浏览、手动录入和已有数据也不会被停用。
                </p>
              </aside>
            </section>
            <SignInMethodsPanel
              api={api}
              csrfToken={csrfToken}
              onCsrfTokenChanged={onCsrfTokenChanged}
            />
            <AccountPreferencesForm api={preferencesApi} initialPreferences={account.preferences} />
          </>
        )}
      </div>
    </>
  );
}

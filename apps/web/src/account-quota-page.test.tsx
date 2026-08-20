import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { quotaSummarySchema, type QuotaSummary } from "@huayi/cloud-contracts";

import { AccountQuotaPage, type AccountQuotaApi } from "./account-quota-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const available = quotaSummarySchema.parse({
  availableMicroUsd: 700_000,
  limitMicroUsd: 1_000_000,
  percentUsed: 20,
  periodEnd: "2026-09-01T00:00:00.000Z",
  periodStart: "2026-08-01T00:00:00.000Z",
  reservedMicroUsd: 100_000,
  usedMicroUsd: 200_000,
  warning: "available",
});
const preferences = {
  cloudWordCopyMode: "enabled" as const,
  dailyGoal: 3,
  extensionQueryModelMode: "platform" as const,
  revision: 1,
  studyCaptureMode: "manual" as const,
  timezone: "UTC",
  updatedAt: "2026-08-13T10:00:00.000Z",
};

function signInMethodsApi() {
  return {
    bootstrap: vi.fn(async () => ({ access: "full" as const, csrfToken: "n".repeat(32) })),
    getAccountSignInMethods: vi.fn(async () => ({
      methods: [{ linkedAt: "2026-08-14T00:00:00.000Z", method: "password" as const }],
    })),
    linkPassword: vi.fn(),
    reauthenticatePassword: vi.fn(),
    startGoogleLink: vi.fn(),
    startGoogleReauthentication: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function render(quotaApi: Pick<AccountQuotaApi, "getQuota">) {
  const container = document.createElement("div");
  document.body.append(container);
  const api: AccountQuotaApi = {
    ...signInMethodsApi(),
    getAccount: vi.fn(async () => ({
      email: "learner@example.com",
      extensionSessions: [],
      minSupportedExtensionVersion: "1.0.0",
      preferences,
    })),
    updateAccountPreferences: vi.fn(async (input) => ({ ...preferences, ...input, revision: 2 })),
    ...quotaApi,
  };
  await act(async () =>
    createRoot(container).render(
      <AccountQuotaPage api={api} csrfToken={"c".repeat(32)} onCsrfTokenChanged={vi.fn()} />,
    ),
  );
  return container;
}

describe("Web account platform quota", () => {
  beforeEach(() => document.body.replaceChildren());

  it("loads one account snapshot and initializes preferences without a duplicate GET", async () => {
    const getAccount = vi.fn(async () => ({
      email: "learner@example.com",
      extensionSessions: [],
      minSupportedExtensionVersion: "1.0.0",
      preferences,
    }));
    const getAccountPreferences = vi.fn(async () => preferences);
    const api = {
      ...signInMethodsApi(),
      getAccount,
      getAccountPreferences,
      getQuota: vi.fn(async () => available),
      updateAccountPreferences: vi.fn(async (input) => ({
        ...preferences,
        ...input,
        revision: 2,
      })),
    };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <AccountQuotaPage api={api} csrfToken={"c".repeat(32)} onCsrfTokenChanged={vi.fn()} />,
      ),
    );
    await act(async () => Promise.resolve());

    expect(getAccount).toHaveBeenCalledOnce();
    expect(getAccountPreferences).not.toHaveBeenCalled();
    expect(container.textContent).toContain("learner@example.com");
    expect(container.textContent).toContain("有效扩展设备0");
    expect(container.textContent).toContain("最低兼容版本1.0.0");
    expect(container.textContent).toContain("密码已绑定");
  });

  it("announces loading and shows the server-owned UTC allowance", async () => {
    const pending = deferred<QuotaSummary>();
    const container = await render({ getQuota: vi.fn(() => pending.promise) });
    expect(container.querySelector("[role='status']")?.textContent).toContain("正在载入账号额度");

    await act(async () => pending.resolve(available));
    expect(container.querySelector("h1")?.textContent).toBe("账号与平台额度");
    expect(container.querySelector("#quota-heading")).toBe(document.activeElement);
    expect(container.querySelector("progress")?.getAttribute("value")).toBe("20");
    expect(container.textContent).toContain("US$1.00");
    expect(container.textContent).toContain("已使用US$0.20");
    expect(container.textContent).toContain("预留中US$0.10");
    expect(container.textContent).toContain("剩余US$0.70");
    expect(container.textContent).toContain("UTC 月度周期");
    expect(container.textContent).toContain("本机 BYOK 不计入");
  });

  it.each([
    [
      {
        ...available,
        availableMicroUsd: 200_000,
        percentUsed: 80,
        reservedMicroUsd: 0,
        usedMicroUsd: 800_000,
        warning: "warning" as const,
      },
      "已使用 80%，请留意本月平台额度",
    ],
    [
      {
        ...available,
        availableMicroUsd: 0,
        percentUsed: 90,
        reservedMicroUsd: 100_000,
        usedMicroUsd: 900_000,
        warning: "exhausted" as const,
      },
      "平台额度已用完",
    ],
  ])("renders the server warning state without disabling BYOK", async (quota, message) => {
    const container = await render({ getQuota: vi.fn(async () => quota) });
    await act(async () => Promise.resolve());
    expect(container.querySelector("[role='status']")?.textContent).toContain(message);
    expect(container.textContent).toContain("BYOK 查询仍可继续");
  });

  it("shows a truthful empty allowance when no grant is configured", async () => {
    const empty = quotaSummarySchema.parse({
      availableMicroUsd: 0,
      limitMicroUsd: 0,
      percentUsed: 100,
      periodEnd: "2026-09-01T00:00:00.000Z",
      periodStart: "2026-08-01T00:00:00.000Z",
      reservedMicroUsd: 0,
      usedMicroUsd: 0,
      warning: "exhausted",
    });
    const container = await render({ getQuota: vi.fn(async () => empty) });
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("尚未配置平台额度");
    expect(container.textContent).toContain("限额US$0.00");
  });

  it("recovers from a read error", async () => {
    const getQuota = vi
      .fn<AccountQuotaApi["getQuota"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(available);
    const container = await render({ getQuota });
    await act(async () => Promise.resolve());
    expect(container.querySelector("[role='alert']")?.textContent).toContain("无法载入账号与额度");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-retry-quota]")?.click(),
    );
    expect(getQuota).toHaveBeenCalledTimes(2);
    expect(container.querySelector("progress")).not.toBeNull();
  });
});

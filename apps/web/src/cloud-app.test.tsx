import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { analysisRecordSchema, contractFixtures } from "@huayi/cloud-contracts";

import type { AnalysisHistoryPageApi } from "./analysis-history-page-api.js";
import type { AccountQuotaApi } from "./account-quota-page.js";
import type { WebAdminOperationsApi } from "./admin-operations-api.js";
import { CloudApp, type IdentityApi } from "./cloud-app.js";
import { WebIdentityApiError } from "./identity-api.js";
import type { PasteAnalysisApi } from "./paste-analysis-page.js";
import type { WebExternalWordbookApi } from "./external-wordbook-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pairing = {
  expiresAt: "2026-08-13T01:00:00.000Z",
  id: "pairing-1",
  pairingPath: "/pair-extension/pairing-1",
  status: "pending" as const,
};
const preferences = {
  cloudWordCopyMode: "enabled" as const,
  dailyGoal: 3,
  extensionQueryModelMode: "platform" as const,
  revision: 1,
  studyCaptureMode: "manual" as const,
  timezone: "UTC",
  updatedAt: "2026-08-13T10:00:00.000Z",
};
const expectedPrimaryNavigation = [
  ["今日练习", "/practice"],
  ["待整理", "/app"],
  ["分析", "/analysis"],
  ["学习库", "/library"],
  ["生词", "/words"],
  ["分析历史", "/history"],
  ["设置", "/settings/account"],
] as const;

function primaryNavigation(container: Element) {
  const navigation = container.querySelector("nav[aria-label='主导航']");
  return [...(navigation?.querySelectorAll<HTMLAnchorElement>("a") ?? [])].map((link) => [
    link.textContent,
    link.getAttribute("href"),
  ]);
}

function api(overrides: Partial<IdentityApi> = {}): IdentityApi {
  return {
    approvePairing: vi.fn(async () => undefined),
    bootstrap: vi.fn(async () => ({ access: "full" as const, csrfToken: "c".repeat(32) })),
    createAccountDataExport: vi.fn(),
    deleteAccount: vi.fn(),
    downloadAccountDataExport: vi.fn(),
    getCurrentAccountDataExport: vi.fn(async () => ({ job: null })),
    getAccountPreferences: vi.fn(async () => preferences),
    getPairing: vi.fn(async () => pairing),
    listExtensionSessions: vi.fn(async () => ({ items: [] })),
    logout: vi.fn(async () => undefined),
    reauthenticatePassword: vi.fn(async () => ({
      access: "full" as const,
      csrfToken: "r".repeat(32),
    })),
    retryAccountDataExport: vi.fn(),
    revokeExtensionSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function render(identity: IdentityApi, pairingId = "pairing-1") {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(<CloudApp identity={identity} pairingId={pairingId} />),
  );
  await act(async () => Promise.resolve());
  return container;
}

async function change(control: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Web account bootstrap and pairing approval", () => {
  beforeEach(() => document.body.replaceChildren());

  it("links a signed-out session to the real password login page", async () => {
    const identity = api({
      bootstrap: vi.fn(async () => {
        throw new WebIdentityApiError("authentication_required", 401);
      }),
    });
    const container = await render(identity);
    expect(container.querySelector("h1")?.textContent).toContain("需要先登录");
    expect(container.querySelector("[role='status']")?.textContent).toContain("当前会话无效");
    expect(container.querySelector<HTMLAnchorElement>("a")?.pathname).toBe("/login");
    expect(container.querySelector("form")).toBeNull();
  });

  it("loads a pending pairing and approves an explicit device label", async () => {
    const identity = api();
    const container = await render(identity);
    expect(container.textContent).toContain("最小选区");
    expect(container.textContent).toContain("最多保留一小时");
    expect(container.textContent).toContain("标题、视频 ID");
    expect(container.textContent).toContain("BYOK Key 与精简结果不会发送给语见");
    expect(container.textContent).toContain("StudyCapture 原始学习意图");
    expect(container.textContent).toContain("CloudWordCopy 单词副本");
    expect(container.textContent).toContain("三项选择相互独立");
    const field = container.querySelector<HTMLInputElement>("input[name='deviceLabel']");
    const consent = container.querySelector<HTMLInputElement>("input[name='cloudUploadConsent']");
    if (field === null) throw new Error("Device label input is missing.");
    if (consent === null) throw new Error("Cloud upload consent is missing.");
    await change(field, "Writing laptop");
    const submit = container.querySelector<HTMLButtonElement>("button[type='submit']");
    expect(submit?.disabled).toBe(true);
    await act(async () => consent.click());
    await act(async () => submit?.click());
    expect(identity.approvePairing).toHaveBeenCalledWith(
      "pairing-1",
      {
        cloudWordCopyMode: "enabled",
        deviceLabel: "Writing laptop",
        expectedPreferencesRevision: 1,
        extensionQueryModelMode: "platform",
        studyCaptureMode: "manual",
      },
      "c".repeat(32),
    );
    expect(container.querySelector("[role='status']")?.textContent).toContain("已批准");
  });

  it("renders account devices only after a successful session bootstrap", async () => {
    const identity = api();
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(<CloudApp identity={identity} page="devices" />),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(identity.bootstrap).toHaveBeenCalledOnce();
    expect(identity.listExtensionSessions).toHaveBeenCalledOnce();
    expect(container.querySelector("h1")?.textContent).toBe("扩展设备");
    expect(primaryNavigation(container)).toEqual(
      expectedPrimaryNavigation.map(([label, href]) => [
        label,
        label === "设置" ? "#main-content" : href,
      ]),
    );
  });

  it("keeps the operator entry and active settings tab consistent across settings pages", async () => {
    const identity = api();
    const adminApi = {
      access: vi.fn(async () => ({ role: "operator" as const })),
      createInvitation: vi.fn<WebAdminOperationsApi["createInvitation"]>(),
      getUsage: vi.fn<WebAdminOperationsApi["getUsage"]>(),
      listAuditEvents: vi.fn<WebAdminOperationsApi["listAuditEvents"]>(),
      listInvitations: vi.fn<WebAdminOperationsApi["listInvitations"]>(),
      listUsers: vi.fn<WebAdminOperationsApi["listUsers"]>(),
      recoverInvitationToken: vi.fn<WebAdminOperationsApi["recoverInvitationToken"]>(),
      revokeInvitation: vi.fn<WebAdminOperationsApi["revokeInvitation"]>(),
      revokeUserDevices: vi.fn<WebAdminOperationsApi["revokeUserDevices"]>(),
      setKillSwitch: vi.fn<WebAdminOperationsApi["setKillSwitch"]>(),
      setUserQuota: vi.fn<WebAdminOperationsApi["setUserQuota"]>(),
      setUserStatus: vi.fn<WebAdminOperationsApi["setUserStatus"]>(),
    } satisfies WebAdminOperationsApi;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(<CloudApp adminApi={adminApi} identity={identity} page="devices" />),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector("nav[aria-label='账号设置'] [aria-current='page']")?.textContent,
    ).toContain("扩展设备");
    expect(container.querySelector("a[href='/admin']")?.textContent).toBe("运营控制台");

    await act(async () =>
      root.render(<CloudApp adminApi={adminApi} identity={identity} page="data" />),
    );
    await act(async () => Promise.resolve());
    expect(
      container.querySelector("nav[aria-label='账号设置'] [aria-current='page']")?.textContent,
    ).toContain("数据与账号");
    expect(container.querySelector("a[href='/admin']")?.textContent).toBe("运营控制台");
    expect(adminApi.access).toHaveBeenCalledOnce();
  });

  it("routes an authenticated account to the pasted-analysis page", async () => {
    const identity = api();
    const analysisApi: PasteAnalysisApi = {
      getRequestStatus: vi.fn(async () => ({
        analysisId: "analysis-1",
        requestId: "request-1",
        state: "completed" as const,
      })),
      startAnalysis: vi.fn(async function* () {
        yield* [];
      }),
    };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <CloudApp analysisApi={analysisApi} identity={identity} page="analysis" />,
      ),
    );
    await act(async () => Promise.resolve());

    expect(container.querySelector("h1")?.textContent).toBe("英文分析");
    expect(container.querySelector("[aria-current='page']")?.textContent).toBe("分析");
  });

  it("routes an authenticated account to the strict quota page", async () => {
    const identity = api();
    const preferences = {
      cloudWordCopyMode: "enabled" as const,
      dailyGoal: 3,
      extensionQueryModelMode: "platform" as const,
      revision: 1,
      studyCaptureMode: "manual" as const,
      timezone: "UTC",
      updatedAt: "2026-08-13T10:00:00.000Z",
    };
    const accountApi: AccountQuotaApi = {
      bootstrap: vi.fn(async () => ({ access: "full" as const, csrfToken: "n".repeat(32) })),
      getAccount: vi.fn(async () => ({
        email: "learner@example.com",
        extensionSessions: [],
        minSupportedExtensionVersion: "1.0.0",
        preferences,
      })),
      getQuota: vi.fn(async () => contractFixtures.quota),
      getAccountSignInMethods: vi.fn(async () => ({
        methods: [{ linkedAt: "2026-08-14T00:00:00.000Z", method: "password" as const }],
      })),
      linkPassword: vi.fn(),
      reauthenticatePassword: vi.fn(),
      startGoogleLink: vi.fn(),
      startGoogleReauthentication: vi.fn(),
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
        <CloudApp accountApi={accountApi} identity={identity} page="account" />,
      ),
    );
    await act(async () => Promise.resolve());

    expect(container.querySelector("h1")?.textContent).toBe("账号与用量");
    expect(container.querySelector("[aria-current='page']")?.textContent).toContain("设置");
  });

  it("uses the bootstrapped CSRF token to reauthenticate a stale admin session", async () => {
    const identity = api();
    const adminApi: WebAdminOperationsApi = {
      access: vi.fn(async () => Promise.reject(new WebIdentityApiError("forbidden", 403))),
      createInvitation: vi.fn(),
      getUsage: vi.fn(),
      listAuditEvents: vi.fn(),
      listInvitations: vi.fn(),
      listUsers: vi.fn(),
      recoverInvitationToken: vi.fn(),
      revokeInvitation: vi.fn(),
      revokeUserDevices: vi.fn(),
      setKillSwitch: vi.fn(),
      setUserQuota: vi.fn(),
      setUserStatus: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <CloudApp adminApi={adminApi} identity={identity} page="admin" />,
      ),
    );
    await act(async () => Promise.resolve());

    const password = container.querySelector<HTMLInputElement>("#admin-current-password");
    if (password === null) throw new Error("Operator password input is missing.");
    await change(password, "correct horse battery staple");
    await act(async () =>
      container.querySelector<HTMLFormElement>("[data-admin-reauthentication]")?.requestSubmit(),
    );

    expect(identity.reauthenticatePassword).toHaveBeenCalledWith(
      "correct horse battery staple",
      "c".repeat(32),
    );
    expect(container.textContent).not.toContain("correct horse battery staple");
    expect(container.querySelector("h1")?.textContent).toBe("无法进入运营控制台");
  });

  it("routes an authenticated account to analysis history", async () => {
    const identity = api();
    const record = analysisRecordSchema.parse(contractFixtures.analysis);
    const historyApi: AnalysisHistoryPageApi = {
      archiveAnalysis: vi.fn(async () => record),
      deleteAnalysis: vi.fn(async (id) => ({ deleted: true as const, id })),
      getAnalysis: vi.fn(async () => record),
      listHistory: vi.fn(async () => ({ items: [record], nextCursor: null })),
      processNothingToSave: vi.fn(async () => record),
      restoreAnalysis: vi.fn(async () => record),
    };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <CloudApp historyApi={historyApi} identity={identity} page="history" />,
      ),
    );
    await act(async () => Promise.resolve());

    expect(container.querySelector("h1")?.textContent).toBe("分析历史");
    expect(container.querySelector("[aria-current='page']")?.textContent).toBe("分析历史");
  });

  it("routes an authenticated account to external wordbook jobs", async () => {
    const identity = api();
    const wordbookApi: WebExternalWordbookApi = {
      cancelJob: vi.fn(),
      createJob: vi.fn(),
      downloadWords: vi.fn(),
      getJob: vi.fn(),
      listJobs: vi.fn(async () => ({ items: [], nextCursor: null })),
      retryJob: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <CloudApp identity={identity} page="wordbooks" wordbookApi={wordbookApi} />,
      ),
    );
    await act(async () => Promise.resolve());

    expect(container.querySelector("h1")?.textContent).toBe("外部词典任务");
    expect(
      container.querySelector("nav[aria-label='主导航'] [aria-current='page']")?.textContent,
    ).toBe("生词");
    expect(
      container.querySelector("nav[aria-label='生词设置'] [aria-current='page']")?.textContent,
    ).toBe("外部词典");
  });

  it("withholds full workspace and account navigation from a data-rights-only session", async () => {
    const identity = api({
      bootstrap: vi.fn(async () => ({ access: "data-rights" as const, csrfToken: "r".repeat(32) })),
    });
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(<CloudApp identity={identity} page="data" />),
    );
    await act(async () => Promise.resolve());

    expect(container.querySelector("h1")?.textContent).toBe("导出与删除账号");
    expect(container.querySelector("nav[aria-label='主导航']")).toBeNull();
    expect(container.querySelector("nav[aria-label='账号设置']")).toBeNull();
  });

  it("enters the signed-out view after account deletion is accepted", async () => {
    const identity = api({
      deleteAccount: vi.fn(async () => ({
        accepted: true as const,
        requestedAt: "2026-08-13T10:00:00.000Z",
      })),
    });
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(<CloudApp identity={identity} page="data" />),
    );
    await act(async () => Promise.resolve());

    const checkbox = container.querySelector<HTMLInputElement>("[name='understood']");
    const phrase = container.querySelector<HTMLInputElement>("[name='confirmationPhrase']");
    const prepare = container.querySelector<HTMLButtonElement>("[data-prepare-deletion]");
    if (checkbox === null || phrase === null || prepare === null) {
      throw new Error("Account deletion controls are missing.");
    }
    await act(async () => checkbox.click());
    await change(phrase, "删除我的账号");
    await act(async () => prepare.click());
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-confirm-deletion]")?.click(),
    );

    expect(identity.deleteAccount).toHaveBeenCalledOnce();
    expect(container.querySelector("h1")?.textContent).toBe("需要先登录");
    expect(container.textContent).not.toContain("导出与删除账号");
  });
});

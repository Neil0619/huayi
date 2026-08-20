import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminOperationsPage } from "./admin-operations-page.js";
import type { WebAdminOperationsApi } from "./admin-operations-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user = {
  createdAt: "2026-08-13T05:00:00.000Z",
  deviceCount: 2,
  email: "learner@example.test",
  id: "00000000-0000-0000-0000-000000000002",
  quota: {
    availableMicroUsd: 1_000_000,
    limitMicroUsd: 1_000_000,
    percentUsed: 0,
    periodEnd: "2026-09-01T00:00:00.000Z",
    periodStart: "2026-08-01T00:00:00.000Z",
    reservedMicroUsd: 0,
    usedMicroUsd: 0,
    warning: "available" as const,
  },
  status: "active" as const,
};
const usage = {
  accounts: { active: 1, deleting: 0, disabled: 0, total: 1 },
  analysisRequests: {
    failed: 0,
    p95LatencyMs: 125,
    repaired: 0,
    repairRatePercent: 0,
    succeeded: 2,
    successRatePercent: 100,
    terminal: 2,
  },
  killSwitch: { enabled: false, updatedAt: "2026-08-13T06:00:00.000Z" },
  periodEnd: "2026-09-01T00:00:00.000Z",
  periodStart: "2026-08-01T00:00:00.000Z",
  quota: {
    availableMicroUsd: 1_000_000,
    limitMicroUsd: 1_000_000,
    reservedMicroUsd: 0,
    usedMicroUsd: 0,
  },
  usageCalls: { failed: 0, succeeded: 2 },
};

async function setup(overrides: Partial<WebAdminOperationsApi> = {}) {
  const api = {
    access: vi.fn(async () => ({ role: "operator" as const })),
    createInvitation: vi.fn(async () => ({
      consumedAt: null,
      createdAt: "2026-08-13T06:00:00.000Z",
      expiresAt: "2026-08-14T06:00:00.000Z",
      id: "80000000-0000-0000-0000-000000000001",
      invitationPath: "/join#abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
      revokedAt: null,
    })),
    getUsage: vi.fn(async () => usage),
    listAuditEvents: vi.fn(async () => ({ items: [], nextCursor: null })),
    listInvitations: vi.fn(async () => ({ items: [], nextCursor: null })),
    listUsers: vi.fn(async () => ({ items: [user], nextCursor: null })),
    revokeInvitation: vi.fn(async (id: string) => ({ id, revoked: true as const })),
    revokeUserDevices: vi.fn(async () => ({ revokedCount: 2 })),
    setKillSwitch: vi.fn(async (enabled: boolean) => ({
      enabled,
      updatedAt: "2026-08-13T06:01:00.000Z",
    })),
    setUserQuota: vi.fn(async () => ({ id: user.id, quota: user.quota })),
    setUserStatus: vi.fn(async () => ({ id: user.id, status: "disabled" as const })),
    ...overrides,
  } satisfies WebAdminOperationsApi;
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(<AdminOperationsPage api={api} csrfToken="csrf-token" />),
  );
  await act(async () => Promise.resolve());
  return { api, container };
}

function button(container: Element, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Button ${label} is missing.`);
  return found;
}

describe("Admin operations page", () => {
  beforeEach(() => document.body.replaceChildren());

  it("shows only server-proven operator metadata with usage and user filters", async () => {
    const { api, container } = await setup();
    expect(container.querySelector("h1")?.textContent).toBe("运营控制台");
    expect(container.textContent).toContain("learner@example.test");
    expect(container.textContent).toContain("100%");
    const search = container.querySelector<HTMLInputElement>("#admin-email-query");
    if (search === null) throw new Error("Search input is missing.");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        search,
        "LEARNER",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
      search.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button(container, "筛选账号").click());
    expect(api.listUsers).toHaveBeenLastCalledWith("LEARNER", undefined, undefined);
  });

  it("uses explicit confirmation for account disable and updates from the strict response", async () => {
    const { api, container } = await setup();
    await act(async () => button(container, "停用账号").click());
    const confirm = button(container, "确认停用 learner@example.test");
    expect(document.activeElement).toBe(confirm);
    await act(async () => confirm.click());
    expect(api.setUserStatus).toHaveBeenCalledWith(user.id, "disable", "csrf-token");
    expect(container.textContent).toContain("账号已停用，并撤销其登录与扩展访问。");
  });

  it("reveals an invitation only after creation and confirms the global kill switch", async () => {
    const { api, container } = await setup();
    await act(async () => button(container, "创建邀请").click());
    expect(container.textContent).toContain("/join#");
    await act(async () => button(container, "启用模型熔断").click());
    const confirm = button(container, "确认停止平台模型请求");
    expect(document.activeElement).toBe(confirm);
    await act(async () => confirm.click());
    expect(api.setKillSwitch).toHaveBeenCalledWith(true, "csrf-token");
    expect(container.textContent).toContain("平台模型请求已停止。浏览与 BYOK 不受影响。");
  });

  it("fails closed for a non-operator without rendering controls", async () => {
    const { container } = await setup({
      access: vi.fn(async () => Promise.reject(new Error("forbidden"))),
    });
    expect(container.querySelector("[role='alert']")?.textContent).toContain("无法进入运营控制台");
    expect(container.textContent).not.toContain("创建邀请");
  });

  it("keeps confirmed account and usage panels when invitation loading fails", async () => {
    const { container } = await setup({
      listInvitations: vi.fn(async () => Promise.reject(new Error("offline"))),
    });
    expect(container.textContent).toContain("learner@example.test");
    expect(container.textContent).toContain("100%");
    expect(container.textContent).toContain("邀请列表载入失败");
    expect(button(container, "重试邀请列表")).toBeTruthy();
  });

  it("paginates users by the server cursor and confirms invitation revocation", async () => {
    const nextUser = {
      ...user,
      email: "second@example.test",
      id: "00000000-0000-0000-0000-000000000003",
    };
    const listUsers = vi
      .fn<WebAdminOperationsApi["listUsers"]>()
      .mockResolvedValueOnce({ items: [user], nextCursor: "next-users" })
      .mockResolvedValueOnce({ items: [nextUser], nextCursor: null });
    const invitation = {
      consumedAt: null,
      createdAt: "2026-08-13T06:00:00.000Z",
      expiresAt: "2026-08-14T06:00:00.000Z",
      id: "80000000-0000-0000-0000-000000000002",
      revokedAt: null,
    };
    const listInvitations = vi.fn(async () => ({ items: [invitation], nextCursor: null }));
    const { api, container } = await setup({ listInvitations, listUsers });
    await act(async () => button(container, "载入更多账号").click());
    expect(listUsers).toHaveBeenLastCalledWith(undefined, undefined, "next-users");
    expect(container.textContent).toContain("second@example.test");
    await act(async () => button(container, "撤销").click());
    const confirm = button(container, "确认撤销邀请");
    expect(document.activeElement).toBe(confirm);
    await act(async () => confirm.click());
    expect(api.revokeInvitation).toHaveBeenCalledWith(invitation.id, "csrf-token");
  });
});

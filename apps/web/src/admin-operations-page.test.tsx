import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminOperationsPage } from "./admin-operations-page.js";
import type { WebAdminOperationsApi } from "./admin-operations-api.js";
import { WebIdentityApiError } from "./identity-api.js";

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

async function setup(
  overrides: Partial<WebAdminOperationsApi> = {},
  reauthentication?: {
    readonly onCsrfTokenChanged: (csrfToken: string) => void;
    readonly reauthenticatePassword: (
      password: string,
      csrfToken: string,
    ) => Promise<{
      access: "full";
      csrfToken: string;
    }>;
  },
) {
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
    recoverInvitationToken: vi.fn(async (id: string) => ({
      id,
      invitationPath: "/join#recoveredABCDEFGHIJKLMNOPQRSTUVWXYZ12345678",
      recovered: true as const,
    })),
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
    createRoot(container).render(
      <AdminOperationsPage
        api={api}
        csrfToken="csrf-token"
        onCsrfTokenChanged={reauthentication?.onCsrfTokenChanged}
        reauthenticationApi={reauthentication}
      />,
    ),
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

async function change(control: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
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

  it("single-flights invitation creation and clears the previous one-time path at start", async () => {
    let release:
      ((value: Awaited<ReturnType<WebAdminOperationsApi["createInvitation"]>>) => void) | undefined;
    const pending = new Promise<Awaited<ReturnType<WebAdminOperationsApi["createInvitation"]>>>(
      (resolve) => {
        release = resolve;
      },
    );
    const previous = {
      consumedAt: null,
      createdAt: "2026-08-13T06:00:00.000Z",
      expiresAt: "2026-08-14T06:00:00.000Z",
      id: "80000000-0000-0000-0000-000000000001",
      invitationPath: "/join#abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
      revokedAt: null,
    };
    const createInvitation = vi
      .fn<WebAdminOperationsApi["createInvitation"]>()
      .mockResolvedValueOnce(previous)
      .mockReturnValueOnce(pending);
    const { container } = await setup({ createInvitation });

    await act(async () => button(container, "创建邀请").click());
    expect(container.querySelector("output")?.textContent).toBe(previous.invitationPath);

    const createButton = button(container, "创建邀请");
    act(() => {
      createButton.click();
      createButton.click();
    });
    expect(createInvitation).toHaveBeenCalledTimes(2);
    expect(createButton.disabled).toBe(true);
    expect(container.querySelector("output")).toBeNull();

    await act(async () => release?.(previous));
    expect(createButton.disabled).toBe(false);
  });

  it("recovers an ambiguous invitation response without claiming it was not created", async () => {
    const created = {
      consumedAt: null,
      createdAt: "2026-08-13T06:00:00.000Z",
      expiresAt: "2026-08-14T06:00:00.000Z",
      id: "80000000-0000-0000-0000-000000000001",
      invitationPath: "/join#abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
      revokedAt: null,
    };
    const createInvitation = vi
      .fn<WebAdminOperationsApi["createInvitation"]>()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(created);
    const { container } = await setup({ createInvitation });

    await act(async () => button(container, "创建邀请").click());
    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("创建结果未知");
    expect(alert?.textContent).not.toContain("未创建");
    expect(button(container, "创建邀请").disabled).toBe(true);

    await act(async () => button(container, "安全恢复邀请结果").click());
    expect(createInvitation).toHaveBeenLastCalledWith(72, "csrf-token", true);
    expect(container.querySelector("output")?.textContent).toBe(created.invitationPath);
    expect(button(container, "创建邀请").disabled).toBe(false);
  });

  it("projects every invitation lifecycle state and only offers revoke for an active link", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    const invitations = [
      {
        consumedAt: null,
        createdAt: past,
        expiresAt: future,
        id: "80000000-0000-0000-0000-000000000010",
        revokedAt: null,
      },
      {
        consumedAt: past,
        createdAt: past,
        expiresAt: future,
        id: "80000000-0000-0000-0000-000000000011",
        revokedAt: null,
      },
      {
        consumedAt: null,
        createdAt: past,
        expiresAt: future,
        id: "80000000-0000-0000-0000-000000000012",
        revokedAt: past,
      },
      {
        consumedAt: null,
        createdAt: new Date(Date.now() - 120_000).toISOString(),
        expiresAt: past,
        id: "80000000-0000-0000-0000-000000000013",
        revokedAt: null,
      },
    ];
    const { container } = await setup({
      listInvitations: vi.fn(async () => ({ items: invitations, nextCursor: null })),
    });

    const rows = [...container.querySelectorAll("li")].filter((row) =>
      row.textContent?.includes("80000000-0000-0000-0000-0000000000"),
    );
    expect(rows.map((row) => row.querySelector("[aria-label='邀请状态']")?.textContent)).toEqual([
      "可领取",
      "已领取",
      "已撤销",
      "已过期",
    ]);
    expect(rows.map((row) => row.querySelectorAll("button").length)).toEqual([1, 0, 0, 1]);
  });

  it("confirms one expired invitation token rotation and reveals only the new private link", async () => {
    const invitation = {
      consumedAt: null,
      createdAt: "2026-08-13T06:00:00.000Z",
      expiresAt: "2026-08-14T06:00:00.000Z",
      id: "80000000-0000-0000-0000-000000000001",
      revokedAt: null,
    };
    const recoverInvitationToken = vi.fn(async () => ({
      id: invitation.id,
      invitationPath: "/join#recoveredABCDEFGHIJKLMNOPQRSTUVWXYZ12345678",
      recovered: true as const,
    }));
    const { container } = await setup({
      listInvitations: vi.fn(async () => ({ items: [invitation], nextCursor: null })),
      recoverInvitationToken,
    });

    await act(async () => button(container, "恢复私有链接").click());
    expect(container.textContent).toContain("无需输入旧链接");
    const confirmRecovery = button(container, "确认轮换并显示新链接");
    await act(async () => {
      confirmRecovery.click();
      confirmRecovery.click();
    });

    expect(recoverInvitationToken).toHaveBeenCalledWith(invitation.id, "csrf-token", false);
    expect(container.querySelector("output")?.textContent).toBe(
      "/join#recoveredABCDEFGHIJKLMNOPQRSTUVWXYZ12345678",
    );
    expect(container.textContent).toContain("旧链接立即失效");
    expect(recoverInvitationToken).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("恢复私有链接");
  });

  it("fails closed for a non-operator without rendering controls", async () => {
    const { container } = await setup({
      access: vi.fn(async () => Promise.reject(new Error("forbidden"))),
    });
    expect(container.querySelector("[role='alert']")?.textContent).toContain("无法进入运营控制台");
    expect(container.textContent).not.toContain("创建邀请");
  });

  it("password-reauthenticates a stale Operator session before loading and creating an invitation", async () => {
    const access = vi
      .fn<WebAdminOperationsApi["access"]>()
      .mockRejectedValueOnce(new WebIdentityApiError("forbidden", 403))
      .mockResolvedValue({ role: "operator" });
    const reauthenticatePassword = vi.fn(async () => ({
      access: "full" as const,
      csrfToken: "rotated-csrf-token",
    }));
    const onCsrfTokenChanged = vi.fn();
    const { api, container } = await setup(
      { access },
      { onCsrfTokenChanged, reauthenticatePassword },
    );

    expect(container.querySelector("h1")?.textContent).toBe("重新确认 Operator 身份");
    const password = container.querySelector<HTMLInputElement>("#admin-current-password");
    expect(password?.getAttribute("autocomplete")).toBe("current-password");
    if (password === null) throw new Error("Operator password input is missing.");
    await change(password, "correct horse battery staple");
    await act(async () =>
      container.querySelector<HTMLFormElement>("[data-admin-reauthentication]")?.requestSubmit(),
    );

    expect(reauthenticatePassword).toHaveBeenCalledWith(
      "correct horse battery staple",
      "csrf-token",
    );
    expect(onCsrfTokenChanged).toHaveBeenCalledWith("rotated-csrf-token");
    expect(access).toHaveBeenCalledTimes(2);
    expect(container.querySelector("h1")?.textContent).toBe("运营控制台");
    expect(container.textContent).not.toContain("correct horse battery staple");

    await act(async () => button(container, "创建邀请").click());
    expect(api.createInvitation).toHaveBeenCalledWith(72, "rotated-csrf-token");
  });

  it("keeps a failed Operator password reauthentication retryable without rendering the password", async () => {
    const access = vi.fn(async () => Promise.reject(new WebIdentityApiError("forbidden", 403)));
    const reauthenticatePassword = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider password detail"))
      .mockResolvedValueOnce({ access: "full" as const, csrfToken: "rotated-csrf-token" });
    const { container } = await setup(
      { access },
      { onCsrfTokenChanged: vi.fn(), reauthenticatePassword },
    );
    const password = container.querySelector<HTMLInputElement>("#admin-current-password");
    if (password === null) throw new Error("Operator password input is missing.");
    await change(password, "correct horse battery staple");
    await act(async () =>
      container.querySelector<HTMLFormElement>("[data-admin-reauthentication]")?.requestSubmit(),
    );

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "密码确认失败，请检查后重试",
    );
    expect(container.textContent).not.toContain("correct horse battery staple");
    expect(password.value).toBe("correct horse battery staple");
    expect(button(container, "重新确认并进入").disabled).toBe(false);

    await act(async () =>
      container.querySelector<HTMLFormElement>("[data-admin-reauthentication]")?.requestSubmit(),
    );
    expect(reauthenticatePassword).toHaveBeenCalledTimes(2);
    expect(reauthenticatePassword).toHaveBeenLastCalledWith(
      "correct horse battery staple",
      "csrf-token",
    );
    expect(container.querySelector("h1")?.textContent).toBe("无法进入运营控制台");
    expect(container.textContent).not.toContain("correct horse battery staple");
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
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
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

  it("clears a one-time path and requires a list reread after an uncertain revoke", async () => {
    const invitation = {
      consumedAt: null,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: "80000000-0000-0000-0000-000000000014",
      revokedAt: null,
    };
    const listInvitations = vi
      .fn<WebAdminOperationsApi["listInvitations"]>()
      .mockResolvedValueOnce({ items: [invitation], nextCursor: null })
      .mockResolvedValueOnce({ items: [invitation], nextCursor: null })
      .mockResolvedValueOnce({
        items: [{ ...invitation, revokedAt: new Date().toISOString() }],
        nextCursor: null,
      });
    const revokeInvitation = vi.fn(async () => Promise.reject(new Error("response lost")));
    const { container } = await setup({
      createInvitation: vi.fn(async () => ({
        ...invitation,
        invitationPath: "/join#abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
      })),
      listInvitations,
      revokeInvitation,
    });

    await act(async () => button(container, "创建邀请").click());
    expect(container.querySelector("output")).not.toBeNull();
    await act(async () => button(container, "撤销").click());
    await act(async () => button(container, "确认撤销邀请").click());

    expect(revokeInvitation).toHaveBeenCalledOnce();
    expect(container.querySelector("output")).toBeNull();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "撤销结果未知，请先重新载入邀请列表",
    );
    expect(
      [...container.querySelectorAll("button")].some((item) => item.textContent === "撤销"),
    ).toBe(false);
    await act(async () => button(container, "重试邀请列表").click());
    expect(listInvitations).toHaveBeenCalledTimes(3);
    expect(container.querySelector("[aria-label='邀请状态']")?.textContent).toBe("已撤销");
  });
});

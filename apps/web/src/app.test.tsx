import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { App, authenticatedLandingPath } from "./app.js";
import type { AuthApi } from "./auth-page.js";
import type { IdentityApi } from "./cloud-app.js";
import type { PasswordRecoveryApi } from "./password-recovery-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("starts a full workspace session from today's practice", () => {
  expect(authenticatedLandingPath("full")).toBe("/practice");
  expect(authenticatedLandingPath("data-rights")).toBe("/settings/data");
});

it("navigates within the authenticated workspace without bootstrapping the session again", async () => {
  history.replaceState(null, "", "/practice");
  const bootstrap = vi.fn(async () => ({ access: "full" as const, csrfToken: "s".repeat(32) }));
  const identity = {
    approvePairing: vi.fn<IdentityApi["approvePairing"]>(),
    bootstrap,
    claimInvitation: vi.fn<AuthApi["claimInvitation"]>(),
    createAccountDataExport: vi.fn<IdentityApi["createAccountDataExport"]>(),
    deleteAccount: vi.fn<IdentityApi["deleteAccount"]>(),
    downloadAccountDataExport: vi.fn<IdentityApi["downloadAccountDataExport"]>(),
    getAccountPreferences: vi.fn<IdentityApi["getAccountPreferences"]>(),
    getCurrentAccountDataExport: vi.fn<IdentityApi["getCurrentAccountDataExport"]>(),
    getPairing: vi.fn<IdentityApi["getPairing"]>(),
    googleAuthStartUrl: "https://api.huayi.invalid/v1/auth/google/start",
    googleLoginStartUrl: "https://api.huayi.invalid/v1/auth/google/login/start",
    listExtensionSessions: vi.fn<IdentityApi["listExtensionSessions"]>(),
    loginPassword: vi.fn<AuthApi["loginPassword"]>(),
    logout: vi.fn<IdentityApi["logout"]>(),
    registerPassword: vi.fn<AuthApi["registerPassword"]>(),
    reauthenticatePassword: vi.fn<IdentityApi["reauthenticatePassword"]>(),
    resendPasswordRegistration: vi.fn<AuthApi["resendPasswordRegistration"]>(),
    resumePasswordRegistration: vi.fn<AuthApi["resumePasswordRegistration"]>(),
    retryAccountDataExport: vi.fn<IdentityApi["retryAccountDataExport"]>(),
    revokeExtensionSession: vi.fn<IdentityApi["revokeExtensionSession"]>(),
  } satisfies AuthApi & IdentityApi;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<App identity={identity} page="practice" />));
  await act(async () => Promise.resolve());

  await act(async () => container.querySelector<HTMLAnchorElement>("a[href='/library']")?.click());
  const words = container.querySelector<HTMLAnchorElement>("a[href='/words']");
  await act(async () => words?.click());

  expect(location.pathname).toBe("/words");
  expect(words?.getAttribute("aria-current")).toBe("page");
  expect(bootstrap).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain("正在确认登录状态");

  await act(async () => root.unmount());
  history.replaceState(null, "", "/");
});

it("fails closed when the production API origin is unavailable", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => createRoot(container).render(<App />));
  expect(container.querySelector("[role='alert']")?.textContent).toContain("缺少有效的 API Origin");
  expect(container.textContent).not.toContain("正在载入待整理内容");
});

it("renders public privacy without API or identity composition", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => createRoot(container).render(<App publicPage="privacy" />));
  expect(container.querySelector("h1")?.textContent).toBe("语见 Cloud V1 隐私说明");
  expect(container.textContent).not.toContain("缺少有效的 API Origin");
});

it("routes a valid invitation into the real authentication surface", async () => {
  const claimInvitation = vi.fn(async () => ({
    claimTicket: "c".repeat(32),
    expiresAt: "2026-08-13T01:00:00.000Z",
  }));
  const identity: AuthApi & IdentityApi = {
    approvePairing: vi.fn(async () => undefined),
    bootstrap: vi.fn(async () => ({ access: "full" as const, csrfToken: "s".repeat(32) })),
    createAccountDataExport: vi.fn(),
    deleteAccount: vi.fn(),
    downloadAccountDataExport: vi.fn(),
    getCurrentAccountDataExport: vi.fn(async () => ({ job: null })),
    getAccountPreferences: vi.fn(async () => ({
      cloudWordCopyMode: "enabled" as const,
      dailyGoal: 3,
      extensionQueryModelMode: "platform" as const,
      revision: 1,
      studyCaptureMode: "manual" as const,
      timezone: "UTC",
      updatedAt: "2026-08-13T10:00:00.000Z",
    })),
    claimInvitation,
    getPairing: vi.fn(async () => ({
      expiresAt: "2026-08-13T01:00:00.000Z",
      id: "pairing-1",
      pairingPath: "/pair-extension/pairing-1",
      status: "pending" as const,
    })),
    googleAuthStartUrl: "https://api.huayi.invalid/v1/auth/google/start",
    googleLoginStartUrl: "https://api.huayi.invalid/v1/auth/google/login/start",
    listExtensionSessions: vi.fn(async () => ({ items: [] })),
    loginPassword: vi.fn(async () => ({ access: "full" as const, csrfToken: "s".repeat(32) })),
    logout: vi.fn(async () => undefined),
    registerPassword: vi.fn(async () => ({ emailConfirmationRequired: true as const })),
    resendPasswordRegistration: vi.fn(async () => ({ accepted: true as const })),
    reauthenticatePassword: vi.fn(async () => ({
      access: "full" as const,
      csrfToken: "r".repeat(32),
    })),
    resumePasswordRegistration: vi.fn(async () => ({
      access: "full" as const,
      csrfToken: "s".repeat(32),
      emailConfirmationRequired: false as const,
    })),
    retryAccountDataExport: vi.fn(),
    revokeExtensionSession: vi.fn(async () => undefined),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const replaceInvitationUrl = vi.fn();
  await act(async () =>
    createRoot(container).render(
      <App
        authRoute={{ invitationToken: "i".repeat(32), mode: "join" }}
        identity={identity}
        replaceInvitationUrl={replaceInvitationUrl}
      />,
    ),
  );
  await act(async () => Promise.resolve());

  expect(container.querySelector("h1")?.textContent).toBe("接受学习邀请");
  expect(claimInvitation).toHaveBeenCalledWith("i".repeat(32));
  expect(replaceInvitationUrl).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain("Google");
});

it("routes public password recovery without bootstrapping a Huayi session", async () => {
  const recoveryApi: PasswordRecoveryApi = {
    completePasswordRecovery: vi.fn(async () => undefined),
    getPasswordRecoverySession: vi.fn(async () => ({
      csrfToken: "c".repeat(32),
      expiresAt: "2026-08-14T10:15:00.000Z",
    })),
    requestPasswordRecovery: vi.fn(async () => ({ accepted: true as const })),
  };
  const container = document.createElement("div");
  document.body.append(container);

  await act(async () =>
    createRoot(container).render(
      <App
        passwordRecoveryApi={recoveryApi}
        passwordRecoveryRoute={{ clearUrl: false, continuation: false }}
      />,
    ),
  );

  expect(container.querySelector("h1")?.textContent).toBe("恢复密码");
  expect(container.textContent).not.toContain("缺少有效的 API Origin");
  expect(recoveryApi.getPasswordRecoverySession).not.toHaveBeenCalled();
});

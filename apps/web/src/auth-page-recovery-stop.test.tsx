import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPage, type AuthApi } from "./auth-page.js";
import { WebIdentityApiError } from "./identity-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function api(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    claimInvitation: vi.fn(async () => ({
      claimTicket: "c".repeat(32),
      expiresAt: "2026-08-13T01:00:00.000Z",
    })),
    googleAuthStartUrl: "https://api.huayi.invalid/v1/auth/google/start",
    googleLoginStartUrl: "https://api.huayi.invalid/v1/auth/google/login/start",
    loginPassword: vi.fn(async () => ({ access: "full" as const, csrfToken: "s".repeat(32) })),
    registerPassword: vi.fn(async () => ({ emailConfirmationRequired: true as const })),
    resendPasswordRegistration: vi.fn(async () => ({ accepted: true as const })),
    resumePasswordRegistration: vi.fn(async () => ({
      access: "full" as const,
      csrfToken: "s".repeat(32),
      emailConfirmationRequired: false as const,
    })),
    ...overrides,
  };
}

async function render(authApi: AuthApi) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(
      <AuthPage
        api={authApi}
        googleAuthenticationEnabled
        invitationToken={"i".repeat(32)}
        mode="join"
        onAuthenticated={vi.fn()}
        replaceInvitationUrl={vi.fn()}
      />,
    ),
  );
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

describe("Web invitation terminal recovery guidance", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("stops recovery and gives one plain next step after resend returns 401", async () => {
    const authApi = api({
      claimInvitation: vi.fn().mockRejectedValue(new Error("bound")),
      resendPasswordRegistration: vi
        .fn()
        .mockRejectedValue(new WebIdentityApiError("authentication_required", 401)),
    });
    const container = await render(authApi);
    await act(async () => Promise.resolve());
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-resend-registration]")?.click(),
    );

    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "没有发送新的验证码。请不要重复点击。请联系发送邀请的人，让对方检查邀请状态。",
    );
    expect(container.querySelector("[data-retry-invitation]")).toBeNull();
    expect(container.querySelector("[data-resend-registration]")).toBeNull();
    expect(container.querySelector("[data-resume-registration]")).toBeNull();
    expect(container.textContent).not.toContain("i".repeat(32));
  });

  it("stops recovery and gives one plain next step after resume returns 401", async () => {
    const authApi = api({
      claimInvitation: vi.fn().mockRejectedValue(new Error("bound")),
      resumePasswordRegistration: vi
        .fn()
        .mockRejectedValue(new WebIdentityApiError("authentication_required", 401)),
    });
    const container = await render(authApi);
    await act(async () => Promise.resolve());
    const email = container.querySelector<HTMLInputElement>("#recovery-registration-email");
    const password = container.querySelector<HTMLInputElement>("#recovery-registration-password");
    if (email === null || password === null) throw new Error("Recovery fields missing.");
    await change(email, "learner@example.com");
    await change(password, "password long enough");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-resume-registration]")?.click(),
    );

    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "这次注册目前无法继续。请不要重复提交。请联系发送邀请的人，让对方检查邀请状态。",
    );
    expect(container.querySelector("[data-retry-invitation]")).toBeNull();
    expect(container.querySelector("[data-resend-registration]")).toBeNull();
    expect(container.querySelector("[data-resume-registration]")).toBeNull();
    expect(container.textContent).not.toContain("i".repeat(32));
  });
});

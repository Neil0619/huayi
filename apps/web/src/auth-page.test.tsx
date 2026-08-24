import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPage, type AuthApi } from "./auth-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

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

async function render(
  authApi: AuthApi,
  props: { invitationToken: string; mode: "join" } | { mode: "login" },
  replaceInvitationUrl = vi.fn(),
  onAuthenticated = vi.fn(),
  googleAuthenticationEnabled = true,
) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(
      <AuthPage
        api={authApi}
        googleAuthenticationEnabled={googleAuthenticationEnabled}
        onAuthenticated={onAuthenticated}
        replaceInvitationUrl={replaceInvitationUrl}
        {...props}
      />,
    ),
  );
  return { container, onAuthenticated, replaceInvitationUrl };
}

async function change(control: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Web invitation and authentication", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("claims from memory, removes the invitation URL, and exposes only a native Google body", async () => {
    const pending = deferred<{ claimTicket: string; expiresAt: string }>();
    const authApi = api({ claimInvitation: vi.fn(() => pending.promise) });
    const view = await render(authApi, { invitationToken: "i".repeat(32), mode: "join" });
    expect(view.container.querySelector("[role='status']")?.textContent).toContain("正在验证邀请");

    await act(async () =>
      pending.resolve({
        claimTicket: "c".repeat(32),
        expiresAt: "2026-08-13T01:00:00.000Z",
      }),
    );
    expect(view.replaceInvitationUrl).toHaveBeenCalledOnce();
    const google = view.container.querySelector<HTMLFormElement>("[data-google-auth-form]");
    expect(google?.action).toBe("https://api.huayi.invalid/v1/auth/google/start");
    expect(google?.method).toBe("post");
    expect(google?.querySelector<HTMLInputElement>("input[name='claimTicket']")?.value).toBe(
      "c".repeat(32),
    );
    expect(view.container.textContent).not.toContain("i".repeat(32));
    expect(view.container.textContent).not.toContain("c".repeat(32));
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("claims a one-time invitation only once under the production StrictMode shell", async () => {
    const authApi = api();
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <StrictMode>
          <AuthPage
            api={authApi}
            googleAuthenticationEnabled
            invitationToken={"i".repeat(32)}
            mode="join"
            onAuthenticated={vi.fn()}
            replaceInvitationUrl={vi.fn()}
          />
        </StrictMode>,
      ),
    );
    await act(async () => Promise.resolve());

    expect(authApi.claimInvitation).toHaveBeenCalledOnce();
  });

  it("announces a failed invitation and retries without exposing its token", async () => {
    const claimInvitation = vi
      .fn<AuthApi["claimInvitation"]>()
      .mockRejectedValueOnce(new Error("expired"))
      .mockResolvedValueOnce({
        claimTicket: "c".repeat(32),
        expiresAt: "2026-08-13T01:00:00.000Z",
      });
    const view = await render(api({ claimInvitation }), {
      invitationToken: "i".repeat(32),
      mode: "join",
    });
    await act(async () => Promise.resolve());
    expect(view.container.querySelector("[role='alert']")?.textContent).toContain("邀请验证失败");
    expect(view.container.textContent).not.toContain("i".repeat(32));

    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-retry-invitation]")?.click(),
    );
    expect(claimInvitation).toHaveBeenCalledTimes(2);
    expect(view.replaceInvitationUrl).toHaveBeenCalledOnce();
  });

  it("registers with labelled fields and announces email confirmation without fake sign-in", async () => {
    const authApi = api();
    const view = await render(authApi, { invitationToken: "i".repeat(32), mode: "join" });
    await act(async () => Promise.resolve());
    const email = view.container.querySelector<HTMLInputElement>("#registration-email");
    const password = view.container.querySelector<HTMLInputElement>("#registration-password");
    if (email === null || password === null) throw new Error("Registration fields missing.");
    await change(email, "learner@example.com");
    await change(password, "password long enough");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-register]")?.click(),
    );

    expect(authApi.registerPassword).toHaveBeenCalledWith(
      "c".repeat(32),
      "learner@example.com",
      "password long enough",
    );
    expect(view.container.querySelector("[role='status']")?.textContent).toBe(
      "注册已提交。请从验证邮件打开确认页，并输入邮件中的六位验证码。",
    );
    expect(view.onAuthenticated).not.toHaveBeenCalled();
    expect(view.container.querySelector("[data-google-auth-form]")).toBeNull();
    expect(view.container.querySelector("[data-resend-registration]")).not.toBeNull();
  });

  it("resends a six-digit OTP with the memory-held invitation only", async () => {
    const authApi = api();
    const view = await render(authApi, { invitationToken: "i".repeat(32), mode: "join" });
    await act(async () => Promise.resolve());
    const email = view.container.querySelector<HTMLInputElement>("#registration-email");
    const password = view.container.querySelector<HTMLInputElement>("#registration-password");
    if (email === null || password === null) throw new Error("Registration fields missing.");
    await change(email, "learner@example.com");
    await change(password, "password long enough");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-register]")?.click(),
    );
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-resend-registration]")?.click(),
    );

    expect(authApi.resendPasswordRegistration).toHaveBeenCalledWith("i".repeat(32));
    expect(view.container.querySelector("[role='status']")?.textContent).toContain(
      "新的六位验证码已发送",
    );
    expect(view.container.textContent).not.toContain("i".repeat(32));
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("resends from a bound-claim error with the original memory-held invitation", async () => {
    const authApi = api({ claimInvitation: vi.fn().mockRejectedValue(new Error("bound")) });
    const view = await render(authApi, { invitationToken: "i".repeat(32), mode: "join" });
    await act(async () => Promise.resolve());

    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-resend-registration]")?.click(),
    );

    expect(authApi.resendPasswordRegistration).toHaveBeenCalledWith("i".repeat(32));
    expect(view.container.querySelector("[role='status']")?.textContent).toContain(
      "新的六位验证码已发送",
    );
    expect(view.container.textContent).not.toContain("i".repeat(32));
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("hides every Google authentication control when the deployment capability is disabled", async () => {
    const join = await render(
      api(),
      { invitationToken: "i".repeat(32), mode: "join" },
      vi.fn(),
      vi.fn(),
      false,
    );
    await act(async () => Promise.resolve());
    expect(join.container.querySelector("[data-google-auth-form]")).toBeNull();
    expect(join.container.textContent).not.toContain("Google");
    expect(join.container.textContent).toContain("使用邮箱创建账号");

    const login = await render(api(), { mode: "login" }, vi.fn(), vi.fn(), false);
    expect(login.container.textContent).not.toContain("Google");
    expect(login.container.querySelector("form[action*='google']")).toBeNull();
    expect(login.container.textContent).toContain("使用邮箱密码登录");
  });

  it("continues an interrupted confirmed signup without using ordinary login", async () => {
    const authApi = api({ claimInvitation: vi.fn().mockRejectedValue(new Error("bound")) });
    const view = await render(authApi, { invitationToken: "i".repeat(32), mode: "join" });
    await act(async () => Promise.resolve());
    const email = view.container.querySelector<HTMLInputElement>("#recovery-registration-email");
    const password = view.container.querySelector<HTMLInputElement>(
      "#recovery-registration-password",
    );
    if (email === null || password === null) throw new Error("Registration fields missing.");
    await change(email, "learner@example.com");
    await change(password, "password long enough");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-resume-registration]")?.click(),
    );

    expect(authApi.resumePasswordRegistration).toHaveBeenCalledWith(
      "i".repeat(32),
      "learner@example.com",
      "password long enough",
    );
    expect(authApi.loginPassword).not.toHaveBeenCalled();
    expect(view.onAuthenticated).toHaveBeenCalledWith("full");
    expect(view.replaceInvitationUrl).toHaveBeenCalledOnce();
    expect(view.container.querySelector("[role='status']")?.textContent).toContain("邀请已完成");
  });

  it("keeps the original invitation and email retryable when interrupted recovery fails", async () => {
    const authApi = api({
      claimInvitation: vi.fn().mockRejectedValue(new Error("bound")),
      resumePasswordRegistration: vi.fn().mockRejectedValue(new Error("rejected")),
    });
    const view = await render(authApi, { invitationToken: "i".repeat(32), mode: "join" });
    await act(async () => Promise.resolve());
    const email = view.container.querySelector<HTMLInputElement>("#recovery-registration-email");
    const password = view.container.querySelector<HTMLInputElement>(
      "#recovery-registration-password",
    );
    if (email === null || password === null) throw new Error("Recovery fields missing.");
    await change(email, "learner@example.com");
    await change(password, "password long enough");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-resume-registration]")?.click(),
    );

    expect(view.container.querySelector("[role='alert']")?.textContent).toContain(
      "无法继续完成邀请",
    );
    expect(email.value).toBe("learner@example.com");
    expect(view.replaceInvitationUrl).not.toHaveBeenCalled();
    expect(authApi.loginPassword).not.toHaveBeenCalled();
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-resume-registration]")?.click(),
    );
    expect(authApi.resumePasswordRegistration).toHaveBeenLastCalledWith(
      "i".repeat(32),
      "learner@example.com",
      "password long enough",
    );
  });

  it("logs in only after a strict server response and preserves retryable errors", async () => {
    const authApi = api({
      loginPassword: vi
        .fn<AuthApi["loginPassword"]>()
        .mockRejectedValueOnce(new Error("bad"))
        .mockResolvedValueOnce({ access: "full", csrfToken: "s".repeat(32) }),
    });
    const view = await render(authApi, { mode: "login" });
    const email = view.container.querySelector<HTMLInputElement>("#login-email");
    const password = view.container.querySelector<HTMLInputElement>("#login-password");
    if (email === null || password === null) throw new Error("Login fields missing.");
    await change(email, "learner@example.com");
    await change(password, "password long enough");
    const submit = view.container.querySelector<HTMLButtonElement>("[data-login]");
    await act(async () => submit?.click());
    expect(view.container.querySelector("[role='alert']")?.textContent).toContain("登录失败");
    expect(email.value).toBe("learner@example.com");
    await act(async () => submit?.click());
    expect(view.onAuthenticated).toHaveBeenCalledOnce();
    expect(view.container.querySelector("[role='status']")?.textContent).toContain("登录成功");
    expect(view.container.querySelector<HTMLAnchorElement>("a[href='/privacy']")?.textContent).toBe(
      "隐私说明",
    );
    expect(view.container.querySelector<HTMLAnchorElement>("a[href='/recover']")?.textContent).toBe(
      "忘记密码？",
    );
  });
});

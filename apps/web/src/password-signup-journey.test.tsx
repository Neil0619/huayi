import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import { AuthPage, type AuthApi } from "./auth-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const csrfToken = "s".repeat(43);
const email = "learner@example.com";
function api() {
  return {
    claimInvitation: vi.fn(async () => ({
      claimTicket: "c".repeat(32),
      expiresAt: "2026-09-07T02:00:00.000Z",
    })),
    googleAuthStartUrl: "https://api.huayi.invalid/v1/auth/google/start",
    googleLoginStartUrl: "https://api.huayi.invalid/v1/auth/google/login/start",
    loginPassword: vi.fn(),
    registerPassword: vi.fn(),
    resendPasswordRegistration: vi.fn(),
    resumePasswordRegistration: vi.fn(),
    startPasswordSignup: vi.fn(async () => ({ csrfToken, email, step: "verify-email" as const })),
    getPasswordSignupSession: vi.fn(async () => ({
      csrfToken,
      email,
      step: "set-password" as const,
    })),
    verifyPasswordSignup: vi.fn(async () => ({ csrfToken, email, step: "set-password" as const })),
    resendPasswordSignup: vi.fn(async () => ({ accepted: true as const })),
    completePasswordSignup: vi.fn(async () => ({ access: "full" as const, csrfToken })),
  };
}

async function render(authApi: AuthApi, mode: "join" | "signup" = "join") {
  const container = document.createElement("div");
  document.body.append(container);
  const onAuthenticated = vi.fn();
  await act(async () =>
    createRoot(container).render(
      <AuthPage
        api={authApi}
        googleAuthenticationEnabled={false}
        onAuthenticated={onAuthenticated}
        replaceInvitationUrl={vi.fn()}
        {...(mode === "join" ? { mode, invitationToken: "i".repeat(32) } : { mode })}
      />,
    ),
  );
  return { container, onAuthenticated };
}

async function fill(container: HTMLElement, id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (input === null) throw new Error(`Missing field: ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(container: HTMLElement) {
  const form = container.querySelector("form.auth-form");
  if (form === null) throw new Error("Missing registration form.");
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
});

it("keeps the email in place and verifies the OTP before asking for both passwords", async () => {
  const authApi = api();
  const view = await render(authApi);
  expect(view.container.querySelector("input[type=password]")).toBeNull();
  await fill(view.container, "registration-email", email);
  await submit(view.container);
  expect(authApi.startPasswordSignup).toHaveBeenCalledWith("c".repeat(32), email);
  expect(view.container.textContent).toContain(email);
  expect(view.container.querySelector("input[type=email]")).toBeNull();
  expect(view.container.querySelector("input[type=password]")).toBeNull();
  expect(view.onAuthenticated).not.toHaveBeenCalled();
  await fill(view.container, "registration-otp", "123456");
  await submit(view.container);
  expect(authApi.verifyPasswordSignup).toHaveBeenCalledWith("123456", csrfToken);
  expect(view.container.querySelectorAll("input[type=password]")).toHaveLength(2);
  await fill(view.container, "registration-password", "correct horse battery staple");
  await fill(view.container, "registration-password-confirmation", "a different long password");
  await submit(view.container);
  expect(view.container.querySelector("[role=alert]")?.textContent).toContain(
    "两次输入的密码不一致",
  );
  expect(authApi.completePasswordSignup).not.toHaveBeenCalled();
  await fill(view.container, "registration-password-confirmation", "correct horse battery staple");
  expect(view.container.querySelector("[role=alert]")).toBeNull();
  await submit(view.container);
  expect(authApi.completePasswordSignup).toHaveBeenCalledWith(
    "correct horse battery staple",
    csrfToken,
  );
  expect(view.onAuthenticated).toHaveBeenCalledWith("full");
  expect(localStorage).toHaveLength(0);
  expect(sessionStorage).toHaveLength(0);
});

it("stays on the OTP step after a rejected code", async () => {
  const authApi = api();
  authApi.verifyPasswordSignup.mockRejectedValueOnce(new Error("invalid OTP"));
  const view = await render(authApi);
  await fill(view.container, "registration-email", email);
  await submit(view.container);
  await fill(view.container, "registration-otp", "000000");
  await submit(view.container);
  expect(view.container.querySelector("[role=alert]")?.textContent).toContain("验证码");
  expect(view.container.querySelector("input[type=password]")).toBeNull();
  expect(view.onAuthenticated).not.toHaveBeenCalled();
});

it("restores the verified step after a refresh without storing passwords or repeating email", async () => {
  const authApi = api();
  const view = await render(authApi, "signup");
  expect(authApi.getPasswordSignupSession).toHaveBeenCalledOnce();
  expect(authApi.claimInvitation).not.toHaveBeenCalled();
  expect(view.container.textContent).toContain(email);
  expect(view.container.querySelector("input[type=email]")).toBeNull();
  expect(view.container.querySelectorAll("input[type=password]")).toHaveLength(2);
});

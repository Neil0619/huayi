import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPage, type AuthApi } from "./auth-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
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

async function renderPage(
  authApi: AuthApi,
  props: { invitationToken: string; mode: "join" } | { mode: "login" },
) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(
      <AuthPage
        api={authApi}
        googleAuthenticationEnabled
        onAuthenticated={vi.fn()}
        replaceInvitationUrl={vi.fn()}
        {...props}
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

describe("Web authentication single-flight actions", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("submits only one registration while the first same-render request is pending", async () => {
    const pending = deferred<{ emailConfirmationRequired: true }>();
    const registerPassword = vi.fn(() => pending.promise);
    const container = await renderPage(api({ registerPassword }), {
      invitationToken: "i".repeat(32),
      mode: "join",
    });
    await act(async () => Promise.resolve());
    const email = container.querySelector<HTMLInputElement>("#registration-email");
    const password = container.querySelector<HTMLInputElement>("#registration-password");
    const submit = container.querySelector<HTMLButtonElement>("[data-register]");
    if (email === null || password === null || submit === null) {
      throw new Error("Registration controls missing.");
    }
    await change(email, "learner@example.com");
    await change(password, "password long enough");

    act(() => {
      submit.click();
      submit.click();
    });

    expect(registerPassword).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ emailConfirmationRequired: true }));
  });

  it("submits only one login while the first same-render request is pending", async () => {
    const pending = deferred<{ access: "full"; csrfToken: string }>();
    const loginPassword = vi.fn(() => pending.promise);
    const container = await renderPage(api({ loginPassword }), { mode: "login" });
    const email = container.querySelector<HTMLInputElement>("#login-email");
    const password = container.querySelector<HTMLInputElement>("#login-password");
    const submit = container.querySelector<HTMLButtonElement>("[data-login]");
    if (email === null || password === null || submit === null) {
      throw new Error("Login controls missing.");
    }
    await change(email, "learner@example.com");
    await change(password, "password long enough");

    act(() => {
      submit.click();
      submit.click();
    });

    expect(loginPassword).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ access: "full", csrfToken: "s".repeat(32) }));
  });

  it("resumes only one registration while the first same-render request is pending", async () => {
    const pending = deferred<{
      access: "full";
      csrfToken: string;
      emailConfirmationRequired: false;
    }>();
    const resumePasswordRegistration = vi.fn(() => pending.promise);
    const container = await renderPage(
      api({
        claimInvitation: vi.fn().mockRejectedValue(new Error("bound")),
        resumePasswordRegistration,
      }),
      { invitationToken: "i".repeat(32), mode: "join" },
    );
    await act(async () => Promise.resolve());
    const email = container.querySelector<HTMLInputElement>("#recovery-registration-email");
    const password = container.querySelector<HTMLInputElement>("#recovery-registration-password");
    const submit = container.querySelector<HTMLButtonElement>("[data-resume-registration]");
    if (email === null || password === null || submit === null) {
      throw new Error("Recovery controls missing.");
    }
    await change(email, "learner@example.com");
    await change(password, "password long enough");

    act(() => {
      submit.click();
      submit.click();
    });

    expect(resumePasswordRegistration).toHaveBeenCalledOnce();
    await act(async () =>
      pending.resolve({
        access: "full",
        csrfToken: "s".repeat(32),
        emailConfirmationRequired: false,
      }),
    );
  });

  it("starts only one auth mutation when resend and resume fire in the same render", async () => {
    const resendPending = deferred<{ accepted: true }>();
    const resumePending = deferred<{
      access: "full";
      csrfToken: string;
      emailConfirmationRequired: false;
    }>();
    const resendPasswordRegistration = vi.fn(() => resendPending.promise);
    const resumePasswordRegistration = vi.fn(() => resumePending.promise);
    const container = await renderPage(
      api({
        claimInvitation: vi.fn().mockRejectedValue(new Error("bound")),
        resendPasswordRegistration,
        resumePasswordRegistration,
      }),
      { invitationToken: "i".repeat(32), mode: "join" },
    );
    await act(async () => Promise.resolve());
    const email = container.querySelector<HTMLInputElement>("#recovery-registration-email");
    const password = container.querySelector<HTMLInputElement>("#recovery-registration-password");
    const resend = container.querySelector<HTMLButtonElement>("[data-resend-registration]");
    const resume = container.querySelector<HTMLButtonElement>("[data-resume-registration]");
    if (email === null || password === null || resend === null || resume === null) {
      throw new Error("Recovery controls missing.");
    }
    await change(email, "learner@example.com");
    await change(password, "password long enough");

    act(() => {
      resend.click();
      resume.click();
    });

    expect(resendPasswordRegistration).toHaveBeenCalledOnce();
    expect(resumePasswordRegistration).not.toHaveBeenCalled();
    await act(async () => resendPending.resolve({ accepted: true }));
  });
});

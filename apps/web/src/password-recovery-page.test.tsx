import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PasswordRecoveryPage, type PasswordRecoveryApi } from "./password-recovery-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const csrfToken = "c".repeat(32);

function api(overrides: Partial<PasswordRecoveryApi> = {}): PasswordRecoveryApi {
  return {
    completePasswordRecovery: vi.fn(async () => undefined),
    getPasswordRecoverySession: vi.fn(async () => ({
      csrfToken,
      expiresAt: "2026-08-14T10:15:00.000Z",
    })),
    requestPasswordRecovery: vi.fn(async () => ({ accepted: true as const })),
    ...overrides,
  };
}

async function render(
  recoveryApi: PasswordRecoveryApi,
  route = { clearUrl: false, continuation: false },
) {
  const container = document.createElement("div");
  document.body.append(container);
  const onCompleted = vi.fn();
  const replaceRecoveryUrl = vi.fn();
  await act(async () =>
    createRoot(container).render(
      <PasswordRecoveryPage
        api={recoveryApi}
        onCompleted={onCompleted}
        replaceRecoveryUrl={replaceRecoveryUrl}
        route={route}
      />,
    ),
  );
  return { container, onCompleted, replaceRecoveryUrl };
}

async function change(control: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Web password recovery page", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("submits one labelled email, clears it, and describes queued delivery honestly", async () => {
    const recoveryApi = api();
    const view = await render(recoveryApi);
    const email = view.container.querySelector<HTMLInputElement>("#recovery-email");
    if (email === null) throw new Error("Recovery email field missing.");
    expect(email.autocomplete).toBe("email");
    await change(email, "learner@example.com");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-request-recovery]")?.click(),
    );

    expect(recoveryApi.requestPasswordRecovery).toHaveBeenCalledWith("learner@example.com");
    expect(email.value).toBe("");
    expect(view.container.querySelector("[role='status']")?.textContent).toContain(
      "恢复请求已提交",
    );
    expect(view.container.querySelector("[role='status']")?.textContent).toContain(
      "几分钟内收到邮件",
    );
    expect(view.container.textContent).not.toContain("我们已发送邮件");
    expect(view.container.textContent).not.toContain("learner@example.com");
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("cleans the continuation URL, loads one purpose session, and focuses the new-password step", async () => {
    const recoveryApi = api();
    const view = await render(recoveryApi, { clearUrl: true, continuation: true });
    await act(async () => Promise.resolve());

    expect(view.replaceRecoveryUrl).toHaveBeenCalledOnce();
    expect(recoveryApi.getPasswordRecoverySession).toHaveBeenCalledOnce();
    expect(view.container.querySelector("h1")?.textContent).toBe("设置新密码");
    expect(document.activeElement).toBe(view.container.querySelector("h1"));
    expect(view.container.textContent).not.toContain(csrfToken);
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("rejects mismatched passwords locally, then submits one matching password and leaves for login", async () => {
    const recoveryApi = api();
    const view = await render(recoveryApi, { clearUrl: true, continuation: true });
    await act(async () => Promise.resolve());
    const password = view.container.querySelector<HTMLInputElement>("#recovery-password");
    const confirmation = view.container.querySelector<HTMLInputElement>(
      "#recovery-password-confirmation",
    );
    if (password === null || confirmation === null) throw new Error("Password fields missing.");
    expect(password.autocomplete).toBe("new-password");
    expect(confirmation.autocomplete).toBe("new-password");
    await change(password, "correct horse battery staple");
    await change(confirmation, "different horse battery staple");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-complete-recovery]")?.click(),
    );
    expect(view.container.querySelector("[role='alert']")?.textContent).toContain(
      "两次输入的密码不一致",
    );
    expect(recoveryApi.completePasswordRecovery).not.toHaveBeenCalled();

    await change(confirmation, "correct horse battery staple");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-complete-recovery]")?.click(),
    );
    expect(recoveryApi.completePasswordRecovery).toHaveBeenCalledWith(
      "correct horse battery staple",
      csrfToken,
    );
    expect(view.container.querySelector("#recovery-password")).toBeNull();
    expect(view.container.querySelector("#recovery-password-confirmation")).toBeNull();
    expect(view.onCompleted).toHaveBeenCalledOnce();
  });

  it("preserves correctable input on completion failure and offers a fresh request for invalid proof", async () => {
    const completePasswordRecovery = vi.fn(async () => {
      throw new Error("unavailable");
    });
    const recoveryApi = api({ completePasswordRecovery });
    const view = await render(recoveryApi, { clearUrl: true, continuation: true });
    await act(async () => Promise.resolve());
    const password = view.container.querySelector<HTMLInputElement>("#recovery-password");
    const confirmation = view.container.querySelector<HTMLInputElement>(
      "#recovery-password-confirmation",
    );
    if (password === null || confirmation === null) throw new Error("Password fields missing.");
    await change(password, "correct horse battery staple");
    await change(confirmation, "correct horse battery staple");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-complete-recovery]")?.click(),
    );
    expect(password.value).toBe("correct horse battery staple");
    expect(view.container.querySelector("[role='alert']")?.textContent).toContain(
      "无法完成密码恢复",
    );

    const invalid = await render(
      api({
        getPasswordRecoverySession: vi.fn(async () => {
          throw new Error("expired");
        }),
      }),
      { clearUrl: true, continuation: true },
    );
    await act(async () => Promise.resolve());
    expect(invalid.container.querySelector("[role='alert']")?.textContent).toContain(
      "恢复链接无效或已过期",
    );
    await act(async () =>
      invalid.container.querySelector<HTMLButtonElement>("[data-restart-recovery]")?.click(),
    );
    expect(invalid.container.querySelector("#recovery-email")).not.toBeNull();
  });
});

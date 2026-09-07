import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebIdentityApiError } from "./identity-api.js";
import { PasswordRecoveryPage, type PasswordRecoveryApi } from "./password-recovery-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const csrfToken = "c".repeat(32);
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.useRealTimers();
});

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
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
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

  it("uses concise recovery copy that explains the uniform response", async () => {
    const view = await render(api());
    const introduction = view.container.querySelector(".auth-intro")?.textContent ?? "";

    expect(introduction).toContain("登录邮箱");
    expect(introduction).toContain("为保护账号");
    expect(introduction).toContain("邮箱是否存在");
    expect(introduction.length).toBeLessThanOrEqual(52);
  });

  it("groups the recovery utility links into one compact footer", async () => {
    const view = await render(api());

    const footer = view.container.querySelector("nav.password-recovery-footer");
    expect(footer?.getAttribute("aria-label")).toBe("密码恢复辅助链接");
    expect(
      Array.from(footer?.querySelectorAll("a") ?? [], (link) => link.textContent?.trim()),
    ).toEqual(["返回登录", "隐私说明"]);
    expect(view.container.querySelectorAll(".auth-footer")).toHaveLength(1);
  });

  it("replaces the email form with a clear check-mail step and a resend cooldown", async () => {
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
    expect(view.container.querySelector("#recovery-email")).toBeNull();
    expect(view.container.querySelector("h1")?.textContent).toBe("请查收恢复邮件");
    expect(
      view.container.querySelector<HTMLButtonElement>("[data-resend-recovery]")?.disabled,
    ).toBe(true);
    expect(view.container.querySelector("[role='status']")?.textContent).toContain(
      "恢复请求已提交",
    );
    expect(view.container.querySelector("[role='status']")?.textContent).toContain("几分钟");
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

  it("resends the original email only after the cooldown without restoring an empty form", async () => {
    vi.useFakeTimers();
    const recoveryApi = api();
    const view = await render(recoveryApi);
    const email = view.container.querySelector<HTMLInputElement>("#recovery-email");
    if (!email) throw Error("Email field missing");
    await change(email, "learner@example.com");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-request-recovery]")?.click(),
    );
    const resend = view.container.querySelector<HTMLButtonElement>("[data-resend-recovery]");
    expect(resend?.disabled).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(120000);
    });
    expect(resend?.disabled).toBe(false);
    await act(async () => {
      resend?.click();
      resend?.click();
    });
    expect(recoveryApi.requestPasswordRecovery).toHaveBeenCalledTimes(2);
    expect(recoveryApi.requestPasswordRecovery).toHaveBeenLastCalledWith("learner@example.com");
    expect(view.container.querySelector("#recovery-email")).toBeNull();
    expect(resend?.disabled).toBe(true);
  });

  it("explains request limits and retains correctable email on a failed submission", async () => {
    const view = await render(
      api({
        requestPasswordRecovery: vi
          .fn()
          .mockRejectedValue(new WebIdentityApiError("rate_limited", 429)),
      }),
    );
    const email = view.container.querySelector<HTMLInputElement>("#recovery-email");
    if (!email) throw Error("Email field missing");
    await change(email, "learner@example.com");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-request-recovery]")?.click(),
    );
    expect(view.container.querySelector("[role=alert]")?.textContent).toContain(
      "每小时最多可提交 3 次",
    );
    expect(email.value).toBe("learner@example.com");
    expect(view.container.querySelector("h1")?.textContent).toBe("恢复密码");
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

  it("explains before and after a failed attempt that the new password must be different", async () => {
    const recoveryApi = api({
      completePasswordRecovery: vi.fn(async () => {
        throw new WebIdentityApiError("authentication_required", 401);
      }),
    });
    const view = await render(recoveryApi, { clearUrl: true, continuation: true });
    await act(async () => Promise.resolve());
    const password = view.container.querySelector<HTMLInputElement>("#recovery-password");
    const confirmation = view.container.querySelector<HTMLInputElement>(
      "#recovery-password-confirmation",
    );
    if (password === null || confirmation === null) throw new Error("Password fields missing.");
    expect(view.container.querySelector("#recovery-password-help")?.textContent).toContain(
      "不能与当前密码相同",
    );
    await change(password, "correct horse battery staple");
    await change(confirmation, "correct horse battery staple");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-complete-recovery]")?.click(),
    );

    expect(view.container.querySelector("[role='alert']")?.textContent).toContain(
      "确认新密码与当前密码不同",
    );
    expect(password.value).toBe("correct horse battery staple");
  });
});

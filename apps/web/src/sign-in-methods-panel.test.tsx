import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountSignInMethodsResponse } from "@huayi/cloud-contracts";

import { SignInMethodsPanel, type SignInMethodsApi } from "./sign-in-methods-panel.js";
import { WebIdentityApiError } from "./identity-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const passwordOnly: AccountSignInMethodsResponse = {
  methods: [{ linkedAt: "2026-08-14T00:00:00.000Z", method: "password" as const }],
};
const googleOnly: AccountSignInMethodsResponse = {
  methods: [{ linkedAt: "2026-08-14T00:00:00.000Z", method: "google" as const }],
};
const both: AccountSignInMethodsResponse = {
  methods: [
    { linkedAt: "2026-08-14T00:00:00.000Z", method: "password" as const },
    { linkedAt: "2026-08-14T00:01:00.000Z", method: "google" as const },
  ],
};

function api(methods = passwordOnly): SignInMethodsApi {
  return {
    bootstrap: vi.fn(async () => ({ access: "full" as const, csrfToken: "n".repeat(32) })),
    getAccountSignInMethods: vi.fn().mockResolvedValueOnce(methods).mockResolvedValue(both),
    linkPassword: vi.fn(async () => both),
    reauthenticatePassword: vi.fn(async () => ({
      access: "full" as const,
      csrfToken: "r".repeat(32),
    })),
    startGoogleLink: vi.fn(async () => ({ continueUrl: "https://api.test/google-link" })),
    startGoogleReauthentication: vi.fn(async () => ({
      continueUrl: "https://api.test/google-reauth",
    })),
  };
}

async function render(methods = passwordOnly) {
  const container = document.createElement("div");
  document.body.append(container);
  const identity = api(methods);
  const navigate = vi.fn();
  const onCsrfTokenChanged = vi.fn();
  await act(async () =>
    createRoot(container).render(
      <SignInMethodsPanel
        api={identity}
        csrfToken={"c".repeat(32)}
        navigate={navigate}
        onCsrfTokenChanged={onCsrfTokenChanged}
      />,
    ),
  );
  await act(async () => Promise.resolve());
  return { container, identity, navigate, onCsrfTokenChanged };
}

async function change(control: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("SignInMethodsPanel", () => {
  beforeEach(() => document.body.replaceChildren());

  it("password-reauthenticates before starting Google link and preserves accessible labels", async () => {
    const view = await render();
    expect(view.container.textContent).toContain("密码已绑定");
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-add-google]")?.click(),
    );
    const input = view.container.querySelector<HTMLInputElement>("#current-password");
    expect(input?.getAttribute("autocomplete")).toBe("current-password");
    if (input !== null) await change(input, "correct horse battery staple");
    await act(async () =>
      view.container.querySelector<HTMLFormElement>("[data-google-link-form]")?.requestSubmit(),
    );
    expect(view.identity.reauthenticatePassword).toHaveBeenCalledWith(
      "correct horse battery staple",
      "c".repeat(32),
    );
    expect(view.identity.startGoogleLink).toHaveBeenCalledWith("r".repeat(32));
    expect(view.onCsrfTokenChanged).toHaveBeenCalledWith("r".repeat(32));
    expect(view.navigate).toHaveBeenCalledWith("https://api.test/google-link");
  });

  it("Google-reauthenticates, then links password and refreshes CSRF plus server methods", async () => {
    const view = await render(googleOnly);
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>("[data-google-reauth]")?.click(),
    );
    expect(view.navigate).toHaveBeenCalledWith("https://api.test/google-reauth");

    const input = view.container.querySelector<HTMLInputElement>("#new-password");
    if (input !== null) await change(input, "correct horse battery staple");
    await act(async () =>
      view.container.querySelector<HTMLFormElement>("[data-password-link-form]")?.requestSubmit(),
    );
    expect(view.identity.linkPassword).toHaveBeenCalledWith(
      "correct horse battery staple",
      "c".repeat(32),
    );
    expect(view.identity.bootstrap).toHaveBeenCalledOnce();
    expect(view.identity.getAccountSignInMethods).toHaveBeenCalledTimes(2);
    expect(view.onCsrfTokenChanged).toHaveBeenCalledWith("n".repeat(32));
    expect(view.container.textContent).toContain("密码已绑定");
  });

  it("announces retryable errors and keeps the password out of rendered status", async () => {
    const view = await render(googleOnly);
    vi.mocked(view.identity.linkPassword).mockRejectedValueOnce(new Error("provider secret"));
    const input = view.container.querySelector<HTMLInputElement>("#new-password");
    if (input !== null) await change(input, "correct horse battery staple");
    await act(async () => {
      view.container.querySelector<HTMLFormElement>("[data-password-link-form]")?.requestSubmit();
    });
    expect(view.container.querySelector("[role='alert']")?.textContent).toContain("暂时无法完成");
    expect(view.container.textContent).not.toContain("correct horse battery staple");
    expect(input?.value).toBe("correct horse battery staple");
  });

  it("rereads a stale view and reports an already linked password without provider detail", async () => {
    const view = await render(googleOnly);
    vi.mocked(view.identity.linkPassword).mockRejectedValueOnce(
      new WebIdentityApiError("sign_in_method_already_linked", 409),
    );
    const input = view.container.querySelector<HTMLInputElement>("#new-password");
    if (input !== null) await change(input, "correct horse battery staple");
    await act(async () =>
      view.container.querySelector<HTMLFormElement>("[data-password-link-form]")?.requestSubmit(),
    );

    expect(view.identity.getAccountSignInMethods).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toContain("密码登录方式已经绑定");
    expect(view.container.textContent).not.toContain("correct horse battery staple");
    expect(view.container.textContent).not.toContain("provider detail");
  });
});

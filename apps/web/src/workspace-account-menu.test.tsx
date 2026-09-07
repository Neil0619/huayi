import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudApp } from "./cloud-app.js";
import { createWebIdentityApi } from "./identity-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const email = "learner@example.com";
const roots: Root[] = [];
const csrfToken = "c".repeat(32);

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

async function render(
  options: {
    access?: "data-rights" | "full";
    accountFailure?: boolean;
    logout?: () => Promise<Response>;
  } = {},
) {
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/v1/auth/csrf")
      return Response.json({ access: options.access ?? "full", csrfToken });
    if (path === "/v1/account") {
      if (options.accountFailure) return new Response(null, { status: 503 });
      return Response.json({
        email,
        extensionSessions: [],
        minSupportedExtensionVersion: "1.0.0",
        preferences: {
          cloudWordCopyMode: "enabled",
          dailyGoal: 3,
          extensionQueryModelMode: "platform",
          revision: 1,
          studyCaptureMode: "manual",
          timezone: "UTC",
          updatedAt: "2026-09-07T10:00:00.000Z",
        },
      });
    }
    if (path === "/v1/auth/logout" && init?.method === "POST")
      return options.logout?.() ?? new Response(null, { status: 204 });
    if (path === "/v1/account-data-exports/current") return Response.json({ job: null });
    throw new Error(`Unexpected test request: ${path}`);
  });
  const identity = createWebIdentityApi({ apiOrigin: "https://api.huayi.invalid", fetch: request });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<CloudApp identity={identity} />));
  return { container, identity, request, root };
}

function required<T extends Element>(container: ParentNode, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

async function openMenu(container: Element) {
  const trigger = required<HTMLButtonElement>(container, ".workspace-account-trigger");
  await act(async () => trigger.click());
  return { trigger, menu: required<HTMLElement>(container, "[role='menu']") };
}

describe("workspace account menu", () => {
  it("shows server email in the header, keeps it across routes and navigates only to real settings", async () => {
    const { container, identity, request, root } = await render();
    expect(container.querySelector(".topbar")?.textContent).toContain(email);
    const { trigger, menu } = await openMenu(container);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu.getAttribute("aria-labelledby")).toBe(trigger.id);
    expect([...menu.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/settings/account",
      "/settings/devices",
      "/settings/data",
    ]);
    expect(menu.querySelector("a[href='/admin']")).toBeNull();
    expect(document.activeElement).toBe(menu.querySelector("a"));
    await act(async () => root.render(<CloudApp identity={identity} page="library" />));
    expect(container.querySelector(".topbar")?.textContent).toContain(email);
    expect(
      request.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/v1/account"),
    ).toHaveLength(1);
  });

  it("supports arrow keys, Escape focus return, outside click and focus-leave dismissal", async () => {
    const { container } = await render();
    const { trigger, menu } = await openMenu(container);
    const items = [...menu.querySelectorAll<HTMLElement>("[role='menuitem']")];
    await act(async () =>
      items[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" })),
    );
    expect(document.activeElement).toBe(items.at(-1));
    await act(async () =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    await openMenu(container);
    await act(async () =>
      container.querySelector("h1")?.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(container.querySelector("[role='menu']")).toBeNull();
    await openMenu(container);
    await act(async () => required<HTMLElement>(container, "#main-content").focus());
    expect(container.querySelector("[role='menu']")).toBeNull();
  });

  it("keeps the workspace while logout is pending or fails, then clears it after a proven logout", async () => {
    let resolveLogout: ((response: Response) => void) | undefined;
    const logout = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveLogout = resolve;
        }),
    );
    const { container, request } = await render({ logout });
    await openMenu(container);
    const button = required<HTMLButtonElement>(container, "[role='menu'] button");
    await act(async () => button.click());
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("正在退出…");
    expect(container.querySelector("nav[aria-label='主导航']")).not.toBeNull();
    await act(async () => button.click());
    expect(logout).toHaveBeenCalledOnce();
    await act(async () => resolveLogout?.(new Response(null, { status: 503 })));
    expect(container.querySelector("[role='alert']")?.textContent).toContain("退出失败");
    expect(container.querySelector(".topbar")?.textContent).toContain(email);
    await act(async () => button.click());
    await act(async () => resolveLogout?.(new Response(null, { status: 204 })));
    expect(container.querySelector("h1")?.textContent).toBe("需要先登录");
    expect(container.querySelector(".topbar")).toBeNull();
    const logoutRequest = request.mock.calls.find(
      ([input]) => new URL(String(input)).pathname === "/v1/auth/logout",
    );
    expect(logoutRequest?.[1]).toMatchObject({
      credentials: "include",
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    });
  });

  it("keeps data-rights access limited and never asks for a full account profile", async () => {
    const { container, request } = await render({ access: "data-rights" });
    const { menu } = await openMenu(container);
    expect(container.querySelector("nav[aria-label='主导航']")).toBeNull();
    expect([...menu.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/settings/data",
    ]);
    expect(container.textContent).not.toContain(email);
    expect(
      request.mock.calls.some(([input]) => new URL(String(input)).pathname === "/v1/account"),
    ).toBe(false);
    await act(async () => required<HTMLButtonElement>(menu, "button").click());
    expect(container.querySelector("h1")?.textContent).toBe("需要先登录");
  });

  it("keeps settings and logout available if the account profile cannot load", async () => {
    const { container } = await render({ accountFailure: true });
    const { menu } = await openMenu(container);
    expect(container.textContent).toContain("账户信息暂不可用");
    expect(menu.querySelector("a[href='/settings/account']")).not.toBeNull();
    await act(async () => required<HTMLButtonElement>(menu, "button").click());
    expect(container.querySelector("h1")?.textContent).toBe("需要先登录");
  });
});

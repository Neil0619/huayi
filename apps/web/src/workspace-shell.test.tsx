import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceShell, type WorkspaceSection } from "./workspace-shell.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const expectedNavigation = [
  ["今日练习", "/practice"],
  ["待整理", "/app"],
  ["分析", "/analysis"],
  ["学习库", "/library"],
  ["生词", "/words"],
  ["分析历史", "/history"],
  ["设置", "/settings/account"],
] as const;

const sections: readonly WorkspaceSection[] = [
  "practice",
  "inbox",
  "analysis",
  "library",
  "words",
  "history",
  "settings",
];

afterEach(() => document.body.replaceChildren());

async function render(section: WorkspaceSection) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(
      <WorkspaceShell access="full" activeSection={section}>
        <h1>页面内容</h1>
      </WorkspaceShell>,
    ),
  );
  return container;
}

describe("WorkspaceShell", () => {
  it("owns the exact seven-item primary navigation contract", async () => {
    const container = await render("library");
    const navigation = container.querySelector("nav[aria-label='主导航']");
    const links = [...(navigation?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];

    expect(links.map((link) => link.textContent)).toEqual(
      expectedNavigation.map(([label]) => label),
    );
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      expectedNavigation.map(([label, href]) => (label === "学习库" ? "#main-content" : href)),
    );
    expect(container.querySelectorAll("#main-content")).toHaveLength(1);
    expect(container.querySelector(".skip-link")?.getAttribute("href")).toBe("#main-content");
    expect(container.querySelector("summary")?.textContent).toContain("学习库");
  });

  it("organizes the workspace as a quiet task index instead of a flat admin menu", async () => {
    const container = await render("practice");
    const groups = [...container.querySelectorAll<HTMLElement>("[data-navigation-group]")];

    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "开始",
      "积累",
      "回看",
      "账户",
    ]);
    expect(
      [...container.querySelectorAll("[data-navigation-index]")].map((index) =>
        index.getAttribute("data-navigation-index"),
      ),
    ).toEqual(["01", "02", "03", "04", "05", "06", "07"]);
    expect(container.querySelector(".topbar")?.textContent).toContain("Seen & Said");
  });

  it("marks exactly one current section for every full workspace route group", async () => {
    for (const section of sections) {
      const container = await render(section);
      expect(
        container.querySelectorAll("nav[aria-label='主导航'] [aria-current='page']"),
      ).toHaveLength(1);
      container.remove();
    }
  });

  it("closes the mobile navigation after choosing another workspace page", async () => {
    let narrow = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn(),
        get matches() {
          return narrow;
        },
        media: "(max-width: 48rem)",
        onchange: null,
        removeEventListener: vi.fn(),
      })),
    });
    const container = await render("inbox");
    const disclosure = container.querySelector<HTMLDetailsElement>(".workspace-navigation");
    const practiceLink = container.querySelector<HTMLAnchorElement>("a[href='/practice']");
    practiceLink?.addEventListener("click", (event) => event.preventDefault());

    expect(disclosure?.open).toBe(true);
    narrow = true;
    await act(async () => practiceLink?.click());

    expect(disclosure?.open).toBe(false);
  });

  it("withholds the full navigation from a data-rights-only session", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <WorkspaceShell access="data-rights">
          <h1>导出与永久删除</h1>
        </WorkspaceShell>,
      ),
    );

    expect(container.querySelector("nav[aria-label='主导航']")).toBeNull();
    expect(container.querySelector("main#main-content")?.textContent).toContain("导出与永久删除");
  });
});

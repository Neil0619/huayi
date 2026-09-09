import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.js";

let root: Root;
let container: HTMLDivElement;
const network = vi.fn(() => {
  throw new Error("Public pages must stay offline.");
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.body.replaceChildren();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  network.mockClear();
  vi.stubGlobal("fetch", network);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("public product pages", () => {
  it("opens the home without an API, offers real local links and identifies unavailable entrances", async () => {
    await act(async () => root.render(<App publicPage="home" />));
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toContain("把看见的英文");
    expect(container.textContent).toContain("Turn what you see into what you can say.");
    expect(container.querySelector('a[href="/guide"]')).not.toBeNull();
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
    expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(container.textContent).toContain("小程序体验版准备中");
    expect(container.textContent).toContain("插件安装入口准备中");
    expect(container.querySelector("iframe, form")).toBeNull();
    expect(container.querySelector('a[href*="chromewebstore"], a[download]')).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it("changes the built-in learning example through semantic buttons without sending content", async () => {
    await act(async () => root.render(<App publicPage="home" />));
    const choose = (name: string) => {
      const button = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === name,
      );
      if (!button) throw new Error(`Missing example button: ${name}`);
      return button;
    };
    expect(choose("01 收集").getAttribute("aria-pressed")).toBe("true");
    await act(async () => choose("02 看懂").click());
    expect(container.textContent).toContain("为值得的事留出时间");
    expect(choose("02 看懂").getAttribute("aria-pressed")).toBe("true");
    await act(async () => choose("03 用出来").click());
    expect(container.textContent).toContain("I make time for reading every evening.");
    expect(container.textContent).toContain("内置示例");
    expect(network).not.toHaveBeenCalled();
  });

  it("explains independent WeChat onboarding and optional linking without requiring a web account", async () => {
    await act(async () => root.render(<App publicPage="guide" />));
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.textContent).toContain("微信账号可以独立使用");
    expect(container.textContent).toContain("账号与额度");
    expect(container.textContent).toContain("首版不合并两个独立账号的记录");
    expect(container.textContent).toContain("保存原文不会调用模型");
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
    expect(container.querySelector('a[href="mailto:niu0619@gmail.com"]')).not.toBeNull();
    expect(network).not.toHaveBeenCalled();
  });
});

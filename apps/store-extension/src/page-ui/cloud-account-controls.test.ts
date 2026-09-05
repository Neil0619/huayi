import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudAccountControls } from "./cloud-account-controls.js";

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    "<span data-cloud-session-state></span><button data-cloud-session-action></button><button data-open-web-workspace></button>";
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers();
  document.body.replaceChildren();
});

const reply = (status: string) => ({
  messageVersion: STORE_MESSAGE_VERSION,
  type: "store/cloud-session-result",
  status,
  ...(status === "pairing" || status === "connected" ? { expiresAt: "2026-12-01T00:00:00Z" } : {}),
});
const action = () => document.querySelector<HTMLButtonElement>("[data-cloud-session-action]");

describe("shared cloud account controls", () => {
  it("starts real pairing, then refreshes the connected status without another login", async () => {
    let status = "disconnected";
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === "store/cloud-session-start") status = "pairing";
      return reply(status);
    });
    const controls = new CloudAccountControls({ sendMessage, reportError: vi.fn() });
    await controls.initialize();
    action()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendMessage).toHaveBeenCalledWith({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/cloud-session-start",
    });
    expect(document.body.textContent).toContain("等待网页确认");
    status = "connected";
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.body.textContent).toContain("已连接");
    expect(action()?.textContent).toBe("断开");
  });

  it("lets the user reopen approval after closing the pairing page", async () => {
    const sendMessage = vi.fn(async () => reply("pairing"));
    await new CloudAccountControls({ sendMessage, reportError: vi.fn() }).initialize();
    expect(action()?.textContent).toBe("重新打开");
    expect(action()?.disabled).toBe(false);
    action()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendMessage).toHaveBeenLastCalledWith({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/cloud-session-start",
    });
  });

  it("does not describe a build without cloud endpoints as logged out", async () => {
    const sendMessage = vi.fn(async () => reply("not-configured"));
    const controls = new CloudAccountControls({ sendMessage, reportError: vi.fn() });
    await controls.initialize();
    expect(document.body.textContent).toContain("此安装包不支持账号连接");
    expect(action()?.disabled).toBe(true);
    action()?.click();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("allows restarting an expired pairing and stops polling after the page closes", async () => {
    let status = "pairing";
    const sendMessage = vi.fn(async () => reply(status));
    const controls = new CloudAccountControls({ sendMessage, reportError: vi.fn() });
    await controls.initialize();
    status = "expired";
    await vi.advanceTimersByTimeAsync(6000);
    expect(document.body.textContent).toContain("连接已过期");
    expect(action()?.disabled).toBe(false);
    action()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendMessage).toHaveBeenLastCalledWith({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/cloud-session-start",
    });
    controls.dispose();
    const calls = sendMessage.mock.calls.length;
    await vi.advanceTimersByTimeAsync(12000);
    window.dispatchEvent(new Event("focus"));
    expect(sendMessage).toHaveBeenCalledTimes(calls);
  });

  it("retains a connected state when safe disconnection fails", async () => {
    const reportError = vi.fn();
    const controls = new CloudAccountControls({
      sendMessage: async (message) => {
        if (message.type === "store/cloud-session-disconnect") throw new Error("offline");
        return reply("connected");
      },
      reportError,
    });
    await controls.initialize();
    action()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.body.textContent).toContain("已连接");
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining("连接仍保留"));
  });
});

import { afterEach, expect, it, vi } from "vitest";
import { initializeBackfillPanel } from "./backfill-panel.js";

const view = (pendingCount = 496) => ({
  status: {
    scopeId: "account",
    pendingCount,
    enabled: true,
    dailyHour: 8,
    revision: 1,
    unresolvedCount: 0,
    unknownCount: 0,
    lastCheckedAt: null,
  },
  shared: true,
  needsLocalMerge: false,
  checkError: null,
  incomplete: false,
  lastCheckedAt: "2026-09-16T01:58:31.000Z",
});
const control = (label: string) =>
  [...document.querySelectorAll("button")].find((button) => button.textContent === label);
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
  vi.useRealTimers();
});

it("coalesces background progress notifications into snapshot reads without checking new words", async () => {
  let changed: () => void = () => undefined;
  const unsubscribe = vi.fn();
  const sendMessage = vi.fn().mockResolvedValueOnce(view()).mockResolvedValue(view(476));
  initializeBackfillPanel({
    container: document.body,
    sendMessage,
    subscribeProgress(callback) {
      changed = callback;
      return unsubscribe;
    },
  });
  await vi.waitFor(() => expect(document.body.textContent).toContain("待回填 496"));
  for (let index = 0; index < 20; index += 1) changed();
  expect(document.body.textContent).toContain("待回填 496");
  await vi.waitFor(() => expect(document.body.textContent).toContain("待回填 476"));
  expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
    { type: "store/backfill-status" },
    { type: "store/backfill-status" },
  ]);
  window.dispatchEvent(new Event("pagehide"));
  expect(unsubscribe).toHaveBeenCalledOnce();
  changed();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

it("does not replace a completed action with an older in-flight snapshot", async () => {
  let finish: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const sendMessage = vi
    .fn()
    .mockResolvedValueOnce(view())
    .mockReturnValueOnce(pending)
    .mockResolvedValue(view(476));
  const panel = initializeBackfillPanel({ container: document.body, sendMessage });
  await vi.waitFor(() => expect(document.body.textContent).toContain("待回填 496"));
  const reading = panel.refresh();
  control("打开扇贝回填")?.click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("待回填 476"));
  finish(view(496));
  await reading;
  expect(document.body.textContent).not.toContain("待回填 496");
});

it("ends a stuck cache read without discarding last good counts", async () => {
  const sendMessage = vi
    .fn()
    .mockResolvedValueOnce(view())
    .mockReturnValue(new Promise(() => undefined));
  const panel = initializeBackfillPanel({ container: document.body, sendMessage });
  await vi.waitFor(() => expect(document.body.textContent).toContain("待回填 496"));
  vi.useFakeTimers();
  const reading = panel.refresh();
  await vi.advanceTimersByTimeAsync(3_000);
  await reading;
  expect(document.body.textContent).toContain("待回填 496");
  expect(control("打开扇贝回填")?.disabled).toBe(false);
  expect(document.querySelector("[role=alert]")?.textContent).toContain("网络");
});

it("leaves opening available during a background check and explains growing counts", async () => {
  initializeBackfillPanel({
    container: document.body,
    sendMessage: async () => ({ ...view(), checking: true }),
  });
  await vi.waitFor(() => expect(document.body.textContent).toContain("待回填 496"));
  expect(document.body.textContent).toContain("数量会继续更新");
  expect(document.body.textContent).toContain("默认生词本的已有词");
  expect(control("打开扇贝回填")?.disabled).toBe(false);
  expect(control("正在后台检查…")?.disabled).toBe(true);
});

it("does not display placeholder counts or enable actions for an unbound account", async () => {
  const pending = { ...view(0), initializing: true, checkError: "无法连接回填服务" };
  initializeBackfillPanel({ container: document.body, sendMessage: async () => pending });
  await vi.waitFor(() => expect(document.body.textContent).toContain("无法连接回填服务"));
  expect(document.body.textContent).not.toContain("待回填 0");
  expect(control("打开扇贝回填")).toBeUndefined();
  expect(control("开启扇贝回填")).toBeUndefined();
});

it("keeps saved counts and open controls available while a status refresh is slow", async () => {
  let finish: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const sendMessage = vi.fn().mockResolvedValueOnce(view()).mockReturnValueOnce(pending);
  const panel = initializeBackfillPanel({ container: document.body, sendMessage });
  await vi.waitFor(() => expect(document.body.textContent).toContain("待回填 496"));
  const reading = panel.refresh();
  expect(document.body.textContent).toContain("待回填 496");
  expect(document.body.textContent).not.toContain("正在读取回填状态");
  expect(control("打开扇贝回填")?.disabled).toBe(false);
  finish(view(476));
  await reading;
  expect(document.body.textContent).toContain("待回填 476");
});

it("keeps the last good counts when a subsequent read or open request fails", async () => {
  const sendMessage = vi.fn().mockResolvedValueOnce(view()).mockRejectedValue(new Error("offline"));
  const panel = initializeBackfillPanel({ container: document.body, sendMessage });
  await vi.waitFor(() => expect(document.body.textContent).toContain("待回填 496"));
  await panel.refresh();
  expect(document.body.textContent).toContain("待回填 496");
  expect(control("打开扇贝回填")?.disabled).toBe(false);
  control("打开扇贝回填")?.click();
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(control("打开扇贝回填")?.disabled).toBe(false));
  expect(document.body.textContent).toContain("待回填 496");
});

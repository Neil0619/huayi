import { afterEach, expect, it, vi } from "vitest";
import { initializeBackfillPanel } from "./backfill-panel.js";

const view = (scopeId: string, pendingCount: number) => ({
  status: {
    scopeId,
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
  lastCheckedAt: null,
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
});
it("discards an old account response and queues a fresh read when account changes while busy", async () => {
  let finish: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const sendMessage = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(view("account-b", 3));
  let changed: () => void = () => undefined;
  initializeBackfillPanel({
    container: document.body,
    sendMessage,
    subscribe: (callback) => {
      changed = callback;
      return () => undefined;
    },
  });
  changed();
  finish(view("account-a", 42));
  await vi.waitFor(() => expect(document.body.textContent).toContain("待回填 3"));
  expect(document.body.textContent).not.toContain("42");
  expect(sendMessage).toHaveBeenCalledTimes(2);
  const check = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "检查新词",
  );
  check?.click();
  await vi.waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({
      type: "store/backfill-check",
      expectedScope: "account-b",
    }),
  );
});
it("opens the Shanbay review panel without rendering editors inside the popup", async () => {
  const state = {
    ...view("account", 0),
    status: { ...view("account", 0).status, unresolvedCount: 52, unknownCount: 1 },
  };
  const sendMessage = vi.fn(async () => state);
  initializeBackfillPanel({ container: document.body, sendMessage });
  await vi.waitFor(() => expect(document.body.textContent).toContain("需处理 52 · 待确认 1"));
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent === "需处理")
    ?.click();
  await vi.waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({
      type: "store/backfill-open",
      view: "review",
      expectedScope: "account",
    }),
  );
  expect(document.querySelector("input")).toBeNull();
  expect(document.body.textContent).not.toContain("修改并重试");
  expect(sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "store/backfill-unresolved" }),
  );
});

it("disables empty attention details without creating an empty scrolling area", async () => {
  const sendMessage = vi.fn(async () => view("account", 0));
  initializeBackfillPanel({ container: document.body, sendMessage });
  await vi.waitFor(() => expect(document.body.textContent).toContain("需处理 (0)"));
  const details = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "需处理 (0)",
  );
  expect(details?.disabled).toBe(true);
  details?.click();
  expect(sendMessage).toHaveBeenCalledOnce();
  expect(document.body.textContent).not.toContain("没有需处理的词");
});

it("explains a migrated local ledger instead of offering an ineffective enable action", async () => {
  const state = { ...view("local", 2), shared: false, reconnectRequired: true };
  state.status.enabled = false;
  initializeBackfillPanel({ container: document.body, sendMessage: async () => state });
  await vi.waitFor(() => expect(document.body.textContent).toContain("连接原账号"));
  expect(document.body.textContent).not.toContain("开启扇贝回填");
});
it("enables a different account without transferring the previous account's local history", async () => {
  const state = { ...view("account-b", 0), needsLocalMerge: true, localMergeBlocked: true };
  const sendMessage = vi.fn(async () => state);
  const confirm = vi.fn(() => true);
  initializeBackfillPanel({ container: document.body, sendMessage, confirm });
  await vi.waitFor(() => expect(document.body.textContent).toContain("开启扇贝回填"));
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent === "开启扇贝回填")
    ?.click();
  await vi.waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({
      type: "store/backfill-enable",
      enabled: true,
      shareLocal: false,
      expectedScope: "account-b",
    }),
  );
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("原账号的本机历史"));
});

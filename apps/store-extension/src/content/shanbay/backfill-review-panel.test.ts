import { expect, it, vi } from "vitest";
import {
  setup,
  required,
  data,
  sourceAlias,
  secondAlias,
  batchAlias,
  cursorAlias,
} from "./backfill-review.test-support.js";

it("edits and skips through page aliases, preserves drafts on refresh, and does not auto submit", async () => {
  const { panel, root, click, sendMessage, continueBackfill } = setup();
  await panel.open();
  expect(root.textContent).toContain("待回填 0 · 需处理 52 · 待确认 1");
  const input = required(root.querySelector("input"));
  input.value = "frank";
  input.dispatchEvent(new Event("input"));
  await panel.refreshIfOpen();
  expect(required(root.querySelector("input")).value).toBe("frank");
  click("修改并重试");
  await vi.waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({
      type: "store/backfill-page-review-replace",
      sourceAlias,
      target: "frank",
    }),
  );
  await vi.waitFor(() => expect(required(root.querySelector("input")).disabled).toBe(false));
  expect(continueBackfill).not.toHaveBeenCalled();
  click("跳过");
  await vi.waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({
      type: "store/backfill-page-review-discard",
      sourceAlias: secondAlias,
    }),
  );
});
it("requires explicit confirmation for unknown results and never acknowledges them as successful", async () => {
  const { panel, click, sendMessage, confirm } = setup();
  await panel.open();
  confirm.mockReturnValueOnce(false);
  click("核对后重试");
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(sendMessage).toHaveBeenCalledTimes(1);
  click("核对后重试");
  await vi.waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({
      type: "store/backfill-page-review-retry-unknown",
      batchAlias,
    }),
  );
  expect(sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "store/backfill-resolve" }),
  );
});
it("rejects synthetic mutation and continue clicks", async () => {
  const { panel, click, sendMessage, continueBackfill } = setup(false);
  await panel.open();
  click("跳过");
  click("核对后重试");
  click("继续回填");
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(continueBackfill).not.toHaveBeenCalled();
});
it("pages with an opaque cursor and drops previous page actions", async () => {
  const { panel, click, root, sendMessage } = setup();
  await panel.open();
  sendMessage.mockResolvedValueOnce({
    ...data(),
    items: [],
    unknownBatches: [],
    nextCursorAlias: null,
  });
  click("下一页");
  await vi.waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({
      type: "store/backfill-page-review",
      cursorAlias,
    }),
  );
  await vi.waitFor(() => expect(root.querySelector("input")).toBeNull());
});
it("ignores late replies after teardown and clears inaccessible account data", async () => {
  const { panel, root, sendMessage } = setup();
  await panel.open();
  sendMessage.mockResolvedValueOnce({ accepted: false });
  await panel.refreshIfOpen();
  expect(root.querySelector("input")).toBeNull();
  expect(root.textContent).not.toContain("franky");
  let resolve: (value: unknown) => void = () => undefined;
  sendMessage.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const reading = panel.open();
  panel.destroy();
  resolve(data());
  await reading;
  expect(document.querySelector("[data-huayi-backfill]")).toBeNull();
});

it("preserves drafts after a stale revision and prevents further mutations until refresh", async () => {
  const { panel, root, click, sendMessage } = setup();
  await panel.open();
  const input = required(root.querySelector("input"));
  input.value = "frank";
  input.dispatchEvent(new Event("input"));
  sendMessage.mockResolvedValueOnce({ accepted: false, batch: null, reason: "stale" });
  click("修改并重试");
  await vi.waitFor(() =>
    expect(required(root.querySelector('[role="alert"]')).textContent).toContain("刷新"),
  );
  expect(required(root.querySelector("input")).value).toBe("frank");
  expect(
    [...root.querySelectorAll(".row button")].every(
      (button) => (button as HTMLButtonElement).disabled,
    ),
  ).toBe(true);
  await panel.refreshIfOpen();
  expect(required(root.querySelector("input")).value).toBe("frank");
  expect(
    [...root.querySelectorAll(".row button")].every(
      (button) => !(button as HTMLButtonElement).disabled,
    ),
  ).toBe(true);
});

it("discards unresolved and unknown words only after a second trusted click", async () => {
  const { panel, root, click, sendMessage } = setup();
  await panel.open();
  click("全部丢弃（53）");
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(root.textContent).toContain("扇贝已添加的词不会删除");
  click("确认全部丢弃（53）");
  await vi.waitFor(() => expect(root.querySelectorAll("input")).toHaveLength(0));
  expect(sendMessage).toHaveBeenCalledWith({ type: "store/backfill-page-review-discard-all" });
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(root.textContent).not.toContain("结果待确认 ·");
  expect(root.textContent).toContain("已处理完毕");
  expect(root.textContent).not.toContain("正在保存");
});

it("leaves other rows editable while saving and preserves focus and drafts on acknowledgement", async () => {
  const { panel, root, click, sendMessage } = setup();
  await panel.open();
  let finish: (value: unknown) => void = () => undefined;
  sendMessage.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  click("跳过");
  const input = required(root.querySelector<HTMLInputElement>('[aria-label="msg 的回填目标"]'));
  expect(input.disabled).toBe(false);
  input.focus();
  input.value = "message";
  input.dispatchEvent(new Event("input"));
  expect(root.textContent).toContain("正在保存");
  finish({ accepted: true, update: 1, pendingCount: 0, unresolvedCount: 51, unknownCount: 1 });
  await vi.waitFor(() => expect(root.querySelectorAll("input")).toHaveLength(1));
  expect(root.activeElement).toBe(input);
  expect(input.value).toBe("message");
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

import { expect, it, vi } from "vitest";
import { setup, data, batchAlias, secondAlias, required } from "./backfill-review.test-support.js";

const unknownOnly = () => ({
  ...data(),
  unresolvedCount: 0,
  unknownCount: 40,
  items: [],
  unknownBatches: [
    {
      alias: batchAlias,
      headwords: Array.from({ length: 20 }, (_, i) => `worda${String.fromCharCode(97 + i)}`),
    },
    {
      alias: secondAlias,
      headwords: Array.from({ length: 20 }, (_, i) => `wordb${String.fromCharCode(97 + i)}`),
    },
  ],
  nextCursorAlias: null,
});

it("lets the screenshot's two unknown batches be discarded and gives a clear finished state", async () => {
  const { panel, root, click, sendMessage, continueBackfill } = setup();
  sendMessage.mockResolvedValueOnce(unknownOnly());
  await panel.open();
  expect(root.textContent).toContain("待确认 40");
  const discard = required(
    [...root.querySelectorAll("button")].find((button) => button.textContent === "全部丢弃（40）"),
  );
  expect(discard.disabled).toBe(false);
  click("全部丢弃（40）");
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(root.textContent).toContain("不再提醒");
  sendMessage.mockResolvedValueOnce({
    accepted: true,
    update: 1,
    pendingCount: 0,
    unresolvedCount: 0,
    unknownCount: 0,
  });
  click("确认全部丢弃（40）");
  await vi.waitFor(() => expect(root.querySelectorAll(".row")).toHaveLength(0));
  expect(root.textContent).toContain("已处理完毕");
  expect(root.textContent).toContain("可以收起");
  expect(root.textContent).not.toContain("回到首屏");
  expect(continueBackfill).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

it("offers stop-reminding for a whole unknown batch without claiming success or submitting", async () => {
  const { panel, click, sendMessage, confirm, continueBackfill } = setup();
  sendMessage.mockResolvedValueOnce(unknownOnly());
  await panel.open();
  confirm.mockReturnValueOnce(false);
  click("不再提醒");
  expect(sendMessage).toHaveBeenCalledTimes(1);
  sendMessage.mockResolvedValueOnce({
    accepted: true,
    update: 1,
    pendingCount: 0,
    unresolvedCount: 0,
    unknownCount: 20,
  });
  click("不再提醒");
  await vi.waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({
      type: "store/backfill-page-review-discard-unknown",
      batchAlias,
    }),
  );
  expect(sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "store/backfill-resolve" }),
  );
  expect(continueBackfill).not.toHaveBeenCalled();
});

it("can cancel bulk discard and keeps all words visible if saving is uncertain", async () => {
  const { panel, root, click, sendMessage } = setup();
  sendMessage.mockResolvedValueOnce(unknownOnly());
  await panel.open();
  click("全部丢弃（40）");
  click("取消");
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(required(root.querySelector('[role="alert"]')).textContent).toBe("");
  click("全部丢弃（40）");
  sendMessage.mockRejectedValueOnce(new Error("offline"));
  click("确认全部丢弃（40）");
  await vi.waitFor(() => expect(root.textContent).toContain("保存未确认"));
  expect(root.querySelectorAll(".row")).toHaveLength(2);
  expect(root.textContent).not.toContain("已处理完毕");
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

it("clears overlapping unknown rows when one dismissal settles the remaining target count", async () => {
  const { panel, root, click, sendMessage } = setup();
  const view = unknownOnly();
  view.unknownBatches[1] = {
    alias: secondAlias,
    headwords: view.unknownBatches[0]?.headwords ?? [],
  };
  view.unknownCount = 20;
  sendMessage.mockResolvedValueOnce(view);
  await panel.open();
  sendMessage.mockResolvedValueOnce({
    accepted: true,
    update: 1,
    pendingCount: 0,
    unresolvedCount: 0,
    unknownCount: 0,
  });
  click("不再提醒");
  await vi.waitFor(() => expect(root.querySelectorAll(".row")).toHaveLength(0));
  expect(root.textContent).toContain("已处理完毕");
});

import { expect, it, vi } from "vitest";
import { setup, data, required } from "./backfill-review.test-support.js";

it("keeps the newest totals when two row acknowledgements arrive out of order", async () => {
  const { panel, root, sendMessage } = setup();
  await panel.open();
  const replies: ((value: unknown) => void)[] = [];
  sendMessage.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
  for (const row of root.querySelectorAll('.row[data-review-kind="source"]')) {
    required(
      [...row.querySelectorAll("button")].find((button) => button.textContent === "跳过"),
    ).click();
  }
  expect(replies).toHaveLength(2);
  replies[1]?.({
    accepted: true,
    update: 2,
    pendingCount: 0,
    unresolvedCount: 50,
    unknownCount: 1,
  });
  await vi.waitFor(() => expect(root.querySelectorAll("input")).toHaveLength(1));
  replies[0]?.({
    accepted: true,
    update: 1,
    pendingCount: 0,
    unresolvedCount: 51,
    unknownCount: 1,
  });
  await vi.waitFor(() => expect(root.querySelectorAll("input")).toHaveLength(0));
  expect(root.textContent).toContain("需处理 50 · 待确认 1");
  expect(sendMessage).toHaveBeenCalledTimes(3);
});

it("shows a failed save, keeps drafts, and never retries automatically", async () => {
  const { panel, root, click, sendMessage } = setup();
  await panel.open();
  const input = required(root.querySelector("input"));
  input.value = "frank";
  input.dispatchEvent(new Event("input"));
  sendMessage.mockRejectedValueOnce(new Error("offline"));
  click("跳过");
  await vi.waitFor(() => expect(root.textContent).toContain("保存未确认"));
  expect(input.value).toBe("frank");
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(root.querySelectorAll("input")).toHaveLength(2);
});

it("reloads protected unresolved rows after discard-all instead of hiding unknown-held sources", async () => {
  const { panel, root, click, sendMessage } = setup();
  await panel.open();
  const draft = required(root.querySelector("input"));
  draft.value = "frank";
  draft.dispatchEvent(new Event("input"));
  sendMessage.mockResolvedValueOnce({
    accepted: true,
    update: 1,
    pendingCount: 0,
    unresolvedCount: 1,
    unknownCount: 1,
  });
  sendMessage.mockResolvedValueOnce({
    ...data(),
    unresolvedCount: 1,
    items: data().items.slice(0, 1),
  });
  click("全部丢弃（53）");
  click("确认全部丢弃（53）");
  await vi.waitFor(() => expect(root.querySelectorAll("input")).toHaveLength(1));
  expect(root.textContent).toContain("结果待确认 · 1 个词");
  expect(root.textContent).toContain("需处理 1 · 待确认 1");
  expect(required(root.querySelector("input")).value).toBe("frank");
  expect(sendMessage).toHaveBeenCalledTimes(3);
});

it("explains ambiguous lemmas and only fills the chosen candidate without submitting", async () => {
  const { panel, root, click, sendMessage } = setup();
  const view = data();
  sendMessage.mockResolvedValueOnce({
    ...view,
    items: [
      {
        ...view.items[0],
        headword: "axes",
        target: "axes",
        explanation: "存在多个可能的原形",
        candidates: ["ax", "axe"],
      },
    ],
  });
  await panel.open();
  expect(root.textContent).toContain("存在多个可能的原形");
  click("使用 axe");
  expect(required(root.querySelector("input")).value).toBe("axe");
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

it("queues a receipt refresh during a row save and ignores save replies after teardown", async () => {
  const { panel, root, click, sendMessage } = setup();
  await panel.open();
  let done: (value: unknown) => void = () => undefined;
  sendMessage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  click("跳过");
  await panel.refreshIfOpen();
  expect(sendMessage).toHaveBeenCalledTimes(2);
  done({ accepted: true, update: 1, pendingCount: 0, unresolvedCount: 51, unknownCount: 1 });
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(required(root.querySelector("input")).disabled).toBe(false));
  sendMessage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  click("跳过");
  panel.destroy();
  done({ accepted: true, update: 1, pendingCount: 0, unresolvedCount: 51, unknownCount: 1 });
  await Promise.resolve();
  expect(document.querySelector("[data-huayi-backfill]")).toBeNull();
});

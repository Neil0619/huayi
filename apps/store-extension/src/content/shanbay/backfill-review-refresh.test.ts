import { expect, it, vi } from "vitest";
import {
  setup,
  data,
  sourceAlias,
  secondAlias,
  batchAlias,
} from "./backfill-review.test-support.js";

it("refreshes a partially overlapped unknown row after one dismissal on a paginated result", async () => {
  const { panel, root, click, sendMessage } = setup();
  const before = {
    ...data(),
    items: [],
    unresolvedCount: 0,
    unknownCount: 150,
    unknownBatches: [
      { alias: batchAlias, headwords: ["walk"] },
      { alias: secondAlias, headwords: ["walk", "bird"] },
    ],
    nextCursorAlias: null,
  };
  sendMessage.mockResolvedValueOnce(before);
  await panel.open();
  sendMessage.mockResolvedValueOnce({
    accepted: true,
    update: 1,
    pendingCount: 0,
    unresolvedCount: 0,
    unknownCount: 149,
  });
  sendMessage.mockResolvedValueOnce({
    ...before,
    unknownCount: 149,
    unknownBatches: [{ alias: secondAlias, headwords: ["bird"] }],
  });
  click("不再提醒");
  await vi.waitFor(() => expect(root.querySelectorAll(".row")).toHaveLength(1));
  expect(root.querySelector("details p")?.textContent).toBe("bird");
});

it("removes mapped unresolved rows even when off-page counts conceal the stale local row", async () => {
  const { panel, root, click, sendMessage } = setup();
  const visibleSources = [
    { ...data().items[0], alias: sourceAlias, headword: "walking", target: "walk" },
    ...Array.from({ length: 98 }, (_, index) => ({
      ...data().items[0],
      alias: crypto.randomUUID(),
      headword: `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
      target: `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
    })),
  ];
  const before = {
    ...data(),
    items: visibleSources,
    unresolvedCount: 150,
    unknownCount: 1,
    unknownBatches: [{ alias: batchAlias, headwords: ["walk"] }],
  };
  sendMessage.mockResolvedValueOnce(before);
  await panel.open();
  sendMessage.mockResolvedValueOnce({
    accepted: true,
    update: 1,
    pendingCount: 0,
    unresolvedCount: 149,
    unknownCount: 0,
  });
  sendMessage.mockResolvedValueOnce({
    ...before,
    items: visibleSources.slice(1),
    unresolvedCount: 149,
    unknownCount: 0,
    unknownBatches: [],
  });
  click("不再提醒");
  await vi.waitFor(() =>
    expect(root.querySelectorAll('[data-review-kind="unknown"]')).toHaveLength(0),
  );
  expect(
    [...root.querySelectorAll('[data-review-kind="source"]')]
      .map((row) => row.textContent)
      .join(" "),
  ).not.toContain("walking");
});

it("replaces completion notice when reopening now contains unresolved work", async () => {
  const { panel, root, sendMessage } = setup();
  sendMessage.mockResolvedValueOnce({
    ...data(),
    items: [],
    unknownBatches: [],
    unresolvedCount: 0,
    unknownCount: 0,
    nextCursorAlias: null,
  });
  await panel.open();
  expect(root.querySelector(".notice")?.textContent).toBe("已处理完毕");
  sendMessage.mockResolvedValueOnce({
    ...data(),
    items: [data().items[0]],
    unknownBatches: [],
    unresolvedCount: 1,
    unknownCount: 0,
    nextCursorAlias: null,
  });
  await panel.open();
  expect(root.querySelector(".summary")?.textContent).toContain("需处理 1");
  expect(root.querySelector(".notice")?.textContent).not.toContain("已处理完毕");
});

it("clears completion notice/help when the reopened account/page is rejected", async () => {
  const { panel, root, sendMessage } = setup();
  sendMessage.mockResolvedValueOnce({
    ...data(),
    items: [],
    unknownBatches: [],
    unresolvedCount: 0,
    unknownCount: 0,
    nextCursorAlias: null,
  });
  await panel.open();
  sendMessage.mockResolvedValueOnce({ accepted: false, batch: null });
  await panel.open();
  expect(root.querySelector(".summary")?.textContent).toContain("重新打开");
  expect(root.querySelector(".notice")?.textContent).not.toContain("已处理完毕");
  expect(root.querySelector(".help")?.textContent).not.toContain("已处理完毕");
});

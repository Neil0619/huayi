// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { button, deferred, input, mount } from "./draft-test-support";
import library from "../pages/library/index";
import inbox from "../pages/inbox/index";
import history from "../pages/history/index";
import analysis from "../pages/analysis/index";
import itemPage from "../pages/item/index";
import { MiniError } from "../services/errors";
import { session } from "../services/session";
import type { createTestSession } from "./resource-test-support";

const fake = vi.hoisted(() => ({
  show: new Set<() => void>(),
  hide: new Set<() => void>(),
  items: vi.fn(),
  words: vi.fn(),
  captures: vi.fn(),
  analyses: vi.fn(),
  history: vi.fn(),
  capture: vi.fn(),
  word: vi.fn(),
  params: {} as Record<string, string>,
  navigate: vi.fn(),
}));
vi.mock("@tarojs/taro", async () => {
  const { useTestLifecycle } = await import("./resource-test-support");
  return {
    useDidShow: (callback: () => void) => useTestLifecycle(fake.show, callback),
    useDidHide: (callback: () => void) => useTestLifecycle(fake.hide, callback),
    useRouter: () => ({ params: fake.params }),
    default: {
      getStorageSync: () => "silver",
      getCurrentPages: () => [],
      navigateTo: fake.navigate,
      eventCenter: { on: vi.fn(), off: vi.fn() },
    },
  };
});
vi.mock("@tarojs/components", async () => (await import("./draft-test-support")).testComponents);
vi.mock("../services/session", async () => ({
  session: (await import("./resource-test-support")).createTestSession(),
}));
vi.mock("../services/api", () => ({ learningApi: fake }));
vi.mock("../services/tasks", () => ({ listTasks: async () => [], submitTask: vi.fn() }));
vi.mock("./task-view", () => ({
  useTask: () => ({ active: false, snapshot: null }),
  TaskView: () => null,
}));
vi.mock("../services/storage", async () => ({
  localStore: (await import("./draft-test-support")).createStore(),
}));

const expression = (id: string) => ({
  item: { id, content: { type: "expression", text: id, meaningZh: "含义" }, tags: [] },
});
const capture = (id: string) => ({
  capture: { id, title: id, sourceText: "source", updatedAt: "2026-09-09T00:00:00Z" },
});
const practice = (id: string) => ({
  id,
  type: "sentence-creation",
  status: "active",
  createdAt: "2026-09-09T00:00:00Z",
});
let view: ReturnType<typeof mount>;
async function click(label: string) {
  await act(async () => button(view.container, label).click());
}
function noButton(label: string) {
  expect(
    Array.from(view.container.querySelectorAll("button"), (node) => node.textContent),
  ).not.toContain(label);
}
beforeEach(() => {
  vi.resetAllMocks();
  fake.params = {};
  (session as unknown as ReturnType<typeof createTestSession>).changeAccount("owner-a");
});

it("analysis removes its mirrored source when the account is cleared", async () => {
  fake.params = { captureId: "private-capture" };
  fake.capture.mockResolvedValue({
    capture: { id: "private-capture", title: "private title", sourceText: "private source" },
    latestAnalysis: null,
  });
  view = mount(createElement(analysis));
  await act(async () => undefined);
  expect(view.container.textContent).toContain("private source");
  await act(async () =>
    (session as unknown as ReturnType<typeof createTestSession>).changeAccount(null),
  );
  expect(view.container.textContent).not.toContain("private source");
  expect(view.container.textContent).not.toContain("private title");
  noButton("分析原文");
});

it("an existing word cannot be created anew while its context page is pending, and logout removes notes", async () => {
  fake.params = { id: "private-word", type: "word" };
  const word = {
    word: { id: "private-word", headword: "word", notes: "private notes" },
    contexts: { items: [], nextCursor: "context-c2" },
  };
  fake.word.mockResolvedValueOnce(word);
  view = mount(createElement(itemPage));
  await act(async () => undefined);
  await click("编辑笔记");
  const next = deferred<unknown>();
  fake.word.mockReturnValueOnce(next.promise);
  await click("更多语境");
  expect(button(view.container, "保存").disabled).toBe(true);
  await act(async () => next.reject(new MiniError("network_error")));
  expect(button(view.container, "保存").disabled).toBe(true);
  fake.word.mockResolvedValueOnce(word);
  await click("刷新服务器内容");
  expect(button(view.container, "保存").disabled).toBe(false);
  expect(view.container.querySelector("textarea")?.value).toBe("private notes");
  await act(async () =>
    (session as unknown as ReturnType<typeof createTestSession>).changeAccount(null),
  );
  expect(view.container.querySelector("textarea")).toBeNull();
  noButton("保存");
});
afterEach(() => view?.unmount());

it("never navigates an expression ID as a word or offers its cursor during a slow type switch", async () => {
  fake.items.mockResolvedValue({
    items: [expression("expression-id")],
    nextCursor: "expression-c2",
  });
  const words = deferred<unknown>();
  fake.words.mockReturnValue(words.promise);
  view = mount(createElement(library));
  await act(async () => undefined);
  await click("查看与编辑");
  expect(fake.navigate).toHaveBeenLastCalledWith({
    url: "/pages/item/index?id=expression-id&type=expression",
  });
  await click("生词");
  expect(view.container.textContent).not.toContain("expression-id");
  noButton("查看与编辑");
  noButton("下一页");
  expect(fake.words).toHaveBeenLastCalledWith({
    query: undefined,
    archived: false,
    cursor: undefined,
  });
  await act(async () => words.resolve({ items: [{ word: { id: "word-id", headword: "word" } }] }));
  await click("查看与编辑");
  expect(fake.navigate).toHaveBeenLastCalledWith({ url: "/pages/item/index?id=word-id&type=word" });
});

for (const scenario of [
  { name: "library", page: library, load: fake.items, item: expression, open: "查看与编辑" },
  { name: "inbox", page: inbox, load: fake.captures, item: capture, open: "查看原文与分析" },
  { name: "history", page: history, load: fake.history, item: practice, open: "查看作答与反馈" },
]) {
  it(`${scenario.name} clears the prior page on a failed next page and can return home and refresh`, async () => {
    scenario.load.mockResolvedValueOnce({ items: [scenario.item("first-id")], nextCursor: "c2" });
    const next = deferred<unknown>();
    scenario.load.mockReturnValueOnce(next.promise);
    view = mount(createElement(scenario.page));
    await act(async () => undefined);
    await click("下一页");
    noButton(scenario.open);
    noButton("下一页");
    expect(scenario.load).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "c2" }));
    await act(async () => next.reject(new MiniError("network_error")));
    expect(view.container.textContent).toContain("连接中断");
    noButton(scenario.open);
    const first = deferred<unknown>();
    scenario.load.mockReturnValueOnce(first.promise);
    await click("回到第一页");
    expect(scenario.load).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: undefined }));
    expect(view.container.textContent).not.toContain("连接中断");
    noButton(scenario.open);
    await act(async () =>
      first.resolve({ items: [scenario.item("refreshed-id")], nextCursor: "c3" }),
    );
    await click(scenario.open);
    expect(fake.navigate.mock.lastCall?.[0].url).toContain("refreshed-id");
    expect(button(view.container, "下一页").disabled).toBe(false);
  });
}

it("library resets pagination for search and archive filters, ignoring late search results", async () => {
  fake.items.mockResolvedValue({ items: [expression("old")], nextCursor: "c2" });
  view = mount(createElement(library));
  await act(async () => undefined);
  await click("下一页");
  const search = deferred<unknown>();
  fake.items.mockReturnValueOnce(search.promise);
  input(view.container, "new query", "input");
  await click("搜索");
  noButton("查看与编辑");
  noButton("回到第一页");
  expect(fake.items).toHaveBeenLastCalledWith(
    expect.objectContaining({ query: "new query", cursor: undefined }),
  );
  const archived = deferred<unknown>();
  fake.items.mockReturnValueOnce(archived.promise);
  await click("查看已归档");
  expect(fake.items).toHaveBeenLastCalledWith(
    expect.objectContaining({ query: "new query", archived: true, cursor: undefined }),
  );
  await act(async () => search.resolve({ items: [expression("late-search")], nextCursor: "bad" }));
  noButton("查看与编辑");
  noButton("下一页");
  await act(async () => archived.resolve({ items: [expression("archived")] }));
  expect(view.container.textContent).toContain("archived");
  expect(view.container.textContent).not.toContain("late-search");
});

it("inbox restores the selected review filter after hiding and discards earlier capture/search pages", async () => {
  fake.captures.mockResolvedValue({ items: [capture("capture-id")], nextCursor: "capture-c2" });
  view = mount(createElement(inbox));
  await act(async () => undefined);
  await click("下一页");
  const search = deferred<unknown>();
  fake.captures.mockReturnValueOnce(search.promise);
  input(view.container, "chosen query", "input");
  await click("搜索");
  noButton("查看原文与分析");
  noButton("下一页");
  const review = deferred<unknown>();
  fake.analyses.mockReturnValueOnce(review.promise);
  await click("待整理");
  act(() => fake.hide.forEach((callback) => callback()));
  await act(async () => {
    search.resolve({ items: [capture("late capture")] });
    review.resolve({
      items: [{ id: "hidden", source: {}, sourceText: "hidden", createdAt: "2026" }],
    });
  });
  noButton("查看原文与分析");
  noButton("阅读与整理");
  fake.analyses.mockResolvedValue({
    items: [{ id: "analysis-id", source: {}, sourceText: "visible review", createdAt: "2026" }],
  });
  await act(async () => fake.show.forEach((callback) => callback()));
  expect(fake.analyses).toHaveBeenLastCalledWith({
    reviewState: "pendingReview",
    query: "chosen query",
    cursor: undefined,
  });
  await click("阅读与整理");
  expect(fake.navigate).toHaveBeenLastCalledWith({ url: "/pages/analysis/index?id=analysis-id" });
});

it("history hides account-owned rows when the session is cleared while the page is hidden", async () => {
  fake.history.mockResolvedValue({ items: [practice("private-id")], nextCursor: "private-c2" });
  view = mount(createElement(history));
  await act(async () => undefined);
  act(() => fake.hide.forEach((callback) => callback()));
  act(() => (session as unknown as ReturnType<typeof createTestSession>).changeAccount(null));
  noButton("查看作答与反馈");
  noButton("下一页");
  await act(async () => undefined);
  fake.history.mockResolvedValue({ items: [practice("new-owner")] });
  await act(async () =>
    (session as unknown as ReturnType<typeof createTestSession>).changeAccount("owner-b"),
  );
  await act(async () => fake.show.forEach((callback) => callback()));
  await click("查看作答与反馈");
  expect(fake.navigate).toHaveBeenLastCalledWith({ url: "/pages/history/index?id=new-owner" });
});

// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { button, input, mount, practiceFixture } from "../../components/draft-test-support";
import Practice from "./index";

const fake = vi.hoisted(() => ({
  practice: vi.fn(),
  draft: vi.fn(),
  control: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@tarojs/taro", () => ({
  useDidShow: vi.fn(),
  useDidHide: vi.fn(),
  useRouter: () => ({ params: { id: "session" } }),
  default: { getStorageSync: () => "silver", eventCenter: { on: vi.fn(), off: vi.fn() } },
}));
vi.mock(
  "@tarojs/components",
  async () => (await import("../../components/draft-test-support")).testComponents,
);
vi.mock("../../services/session", async () => ({
  session: (await import("../../components/resource-test-support")).createTestSession(),
}));
vi.mock("../../services/api", () => ({
  learningApi: { ...fake, items: async () => ({ items: [] }) },
}));
vi.mock("../../services/tasks", () => ({ listTasks: async () => [], submitTask: fake.submit }));
vi.mock("../../services/storage", async () => ({
  localStore: (await import("../../components/draft-test-support")).createStore(),
}));
vi.mock("../../components/task-view", () => ({
  useTask: () => ({ active: false, snapshot: null }),
  TaskView: () => null,
}));
vi.mock("../../components/practice-rating", () => ({ PracticeRating: () => null }));
import { localStore } from "../../services/storage";

let view: ReturnType<typeof mount>;
beforeEach(() => {
  vi.clearAllMocks();
  localStore.clear();
});
afterEach(() => view.unmount());

it("retains an overlong paste, explains local retention, and restores controls after shortening", async () => {
  fake.practice.mockResolvedValue(practiceFixture());
  view = mount(createElement(Practice));
  await act(async () => undefined);
  const long = "x".repeat(4001);
  const field = input(view.container, long);
  expect(field.value).toBe(long);
  expect(field.hasAttribute("maxlength")).toBe(false);
  expect(localStore.get("practice-draft:session")).toBe(long);
  expect(view.container.textContent).toContain("超过 4000 字符");
  expect(view.container.textContent).toContain("已完整保存在本机");
  expect(button(view.container, "提交并获取反馈").disabled).toBe(true);
  expect(button(view.container, "暂存并暂停").disabled).toBe(true);
  await act(async () => field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(fake.draft).not.toHaveBeenCalled();
  input(view.container, "Shortened answer");
  expect(button(view.container, "提交并获取反馈").disabled).toBe(false);
  expect(button(view.container, "暂存并暂停").disabled).toBe(false);
  expect(view.container.textContent).not.toContain("超过 4000 字符");
});

it("can resume a remotely paused practice with an overlong local draft and then shorten it", async () => {
  const value = practiceFixture();
  fake.practice.mockResolvedValue({ ...value, workspace: { ...value.workspace, phase: "paused" } });
  fake.control.mockResolvedValue(value);
  const long = "x".repeat(4001);
  localStore.set("practice-draft:session", long);
  view = mount(createElement(Practice));
  await act(async () => undefined);
  expect(button(view.container, "继续练习").disabled).toBe(false);
  await act(async () => button(view.container, "继续练习").click());
  expect(fake.control).toHaveBeenCalledWith("session", { action: "resume", expectedRevision: 1 });
  expect(view.container.querySelector("textarea")?.value).toBe(long);
  expect(localStore.get("practice-draft:session")).toBe(long);
  input(view.container, "Shortened answer");
  expect(button(view.container, "提交并获取反馈").disabled).toBe(false);
  expect(button(view.container, "暂存并暂停").disabled).toBe(false);
});

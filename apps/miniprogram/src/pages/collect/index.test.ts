// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { button, deferred, input, mount } from "../../components/draft-test-support";
import type { SavedCapture } from "../../services/capture-save";
import Collect from "./index";

const fake = vi.hoisted(() => ({
  show: new Set<() => void>(),
  ensure: vi.fn(),
  createCapture: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@tarojs/taro", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    useDidShow: (callback: () => void) => {
      const current = useRef(callback);
      current.current = callback;
      useEffect(() => {
        const show = () => current.current();
        fake.show.add(show);
        return () => {
          fake.show.delete(show);
        };
      }, []);
    },
    useDidHide: vi.fn(),
    default: {
      navigateTo: fake.navigate,
      getStorageSync: () => "silver",
      eventCenter: { on: vi.fn(), off: vi.fn() },
    },
  };
});
vi.mock(
  "@tarojs/components",
  async () => (await import("../../components/draft-test-support")).testComponents,
);
vi.mock("../../services/session", () => ({ session: { ensure: fake.ensure } }));
vi.mock("../../services/api", () => ({ learningApi: { createCapture: fake.createCapture } }));
vi.mock("../../services/storage", async () => ({
  localStore: (await import("../../components/draft-test-support")).createStore(),
}));
import { localStore } from "../../services/storage";

let view: ReturnType<typeof mount>;
const capture = { id: "capture", revision: 1 } as SavedCapture["capture"];
const saved: SavedCapture = {
  capture,
  outcome: "created",
  undo: { captureId: capture.id, expectedRevision: 1 },
};
beforeEach(() => {
  vi.clearAllMocks();
  fake.ensure.mockResolvedValue(undefined);
  localStore.clear();
});
afterEach(() => view.unmount());
function show() {
  for (const callback of fake.show) callback();
}

it("keeps edits made while saving and restores them when returning to the collect page", async () => {
  const pending = deferred<SavedCapture>();
  fake.createCapture.mockReturnValue(pending.promise);
  view = mount(createElement(Collect));
  input(view.container, "A");
  act(() => button(view.container, "保存到收集箱").click());
  input(view.container, "B");
  await act(async () => pending.resolve(saved));
  await act(async () => show());
  expect(view.container.querySelector("textarea")?.value).toBe("B");
  expect(localStore.get("collect-draft")).toMatchObject({ text: "B" });
  expect(fake.navigate).toHaveBeenCalledOnce();
});

it("does not offer the already-saved text again after returning", async () => {
  fake.createCapture.mockResolvedValue(saved);
  view = mount(createElement(Collect));
  input(view.container, "A");
  await act(async () => button(view.container, "保存到收集箱").click());
  await act(async () => show());
  expect(view.container.querySelector("textarea")?.value).toBe("");
  expect(button(view.container, "保存到收集箱").disabled).toBe(true);
  expect(localStore.get("collect-draft")).toBeUndefined();
});

it("does not let an older asynchronous restoration overwrite input entered meanwhile", async () => {
  const pending = deferred<undefined>();
  fake.ensure.mockReturnValue(pending.promise);
  localStore.set("collect-draft", {
    text: "old",
    kind: "sentence",
    title: "old title",
    context: "",
  });
  view = mount(createElement(Collect));
  act(() => show());
  input(view.container, "B");
  // A stale background restore must not become authoritative over the open editor.
  localStore.set("collect-draft", {
    text: "old",
    kind: "sentence",
    title: "old title",
    context: "",
  });
  await act(async () => pending.resolve(undefined));
  expect(view.container.querySelector("textarea")?.value).toBe("B");
});

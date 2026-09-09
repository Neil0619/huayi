// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deferred, mount } from "./draft-test-support";
import { useResource } from "./hooks";
import { session } from "../services/session";
import type { createTestSession } from "./resource-test-support";
import { MiniError } from "../services/errors";

const fake = vi.hoisted(() => ({
  show: new Set<() => void>(),
  hide: new Set<() => void>(),
  login: vi.fn(),
}));
vi.mock("@tarojs/taro", async () => {
  const { useTestLifecycle } = await import("./resource-test-support");
  return {
    useDidShow: (callback: () => void) => useTestLifecycle(fake.show, callback),
    useDidHide: (callback: () => void) => useTestLifecycle(fake.hide, callback),
  };
});
vi.mock("./ui", () => ({ loginPage: fake.login }));
vi.mock("../services/session", async () => ({
  session: (await import("./resource-test-support")).createTestSession(),
}));
const testSession = session as unknown as ReturnType<typeof createTestSession>;
let current: ReturnType<typeof useResource<string>>;
let view: ReturnType<typeof mount>;
function probe({ query, loader }: { query: string; loader: () => Promise<string> }) {
  current = useResource(loader, [query]);
  return createElement("span", null, current.data);
}
beforeEach(() => {
  testSession.changeAccount("owner-a");
  vi.clearAllMocks();
});
afterEach(() => view?.unmount());

it("hides old data on query changes, including returning to a previously loaded query", async () => {
  view = mount(createElement(probe, { query: "a", loader: async () => "a result" }));
  await act(async () => undefined);
  const slow = deferred<string>();
  view.render(createElement(probe, { query: "b", loader: () => slow.promise }));
  expect(current.data).toBeNull();
  expect(current.loading).toBe(true);
  await act(async () => slow.reject(new MiniError("network_error")));
  expect(current.data).toBeNull();
  expect(current.error).toContain("连接中断");
  const again = deferred<string>();
  view.render(createElement(probe, { query: "a", loader: () => again.promise }));
  expect(current.data).toBeNull();
  expect(current.error).toBe("");
  await act(async () => again.resolve("fresh a"));
  expect(current.data).toBe("fresh a");
});

it("rejects late queries and hidden-page responses, then refreshes the active query on show", async () => {
  const old = deferred<string>();
  view = mount(createElement(probe, { query: "a", loader: () => old.promise }));
  await act(async () => undefined);
  const hidden = deferred<string>();
  const loader = vi.fn().mockReturnValueOnce(hidden.promise).mockResolvedValue("shown b");
  view.render(createElement(probe, { query: "b", loader }));
  await act(async () => undefined);
  act(() => fake.hide.forEach((callback) => callback()));
  await act(async () => {
    old.resolve("late a");
    hidden.resolve("hidden b");
  });
  expect(current.data).toBeNull();
  await act(async () => fake.show.forEach((callback) => callback()));
  expect(current.data).toBe("shown b");
});

it("retains the current query during refresh but removes it on an authentication failure", async () => {
  const loader = vi.fn().mockResolvedValueOnce("saved");
  view = mount(createElement(probe, { query: "a", loader }));
  await act(async () => undefined);
  const refresh = deferred<string>();
  loader.mockReturnValueOnce(refresh.promise);
  act(() => void current.reload());
  expect(current.data).toBe("saved");
  await act(async () => refresh.reject(new MiniError("authentication_required")));
  expect(current.data).toBeNull();
  expect(fake.login).toHaveBeenCalledOnce();
});

it("clears account-owned data immediately on logout and rejects a prior owner's late response", async () => {
  const slow = deferred<string>();
  const loader = vi.fn().mockResolvedValueOnce("owner a").mockReturnValueOnce(slow.promise);
  view = mount(createElement(probe, { query: "a", loader }));
  await act(async () => undefined);
  act(() => void current.reload());
  await act(async () => undefined);
  act(() => testSession.changeAccount(null));
  expect(current.data).toBeNull();
  await act(async () => undefined);
  loader.mockResolvedValue("owner b");
  await act(async () => testSession.changeAccount("owner-b"));
  expect(current.data).toBe("owner b");
  await act(async () => slow.resolve("late owner a"));
  expect(current.data).toBe("owner b");
});

it("pins the loader before authentication so a superseded query never runs under a newer one", async () => {
  const authentication = deferred<string>();
  const ensure = vi.spyOn(testSession, "ensure").mockReturnValueOnce(authentication.promise);
  const old = vi.fn(async () => "old");
  const next = vi.fn(async () => "next");
  view = mount(createElement(probe, { query: "a", loader: old }));
  view.render(createElement(probe, { query: "b", loader: next }));
  await act(async () => undefined);
  await act(async () => authentication.resolve("token"));
  expect(next).toHaveBeenCalledOnce();
  expect(current.data).toBe("next");
  ensure.mockRestore();
});

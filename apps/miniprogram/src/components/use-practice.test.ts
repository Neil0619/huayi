// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, practiceFixture, savedPractice } from "./draft-test-support";
import { usePractice } from "./use-practice";

const fake = vi.hoisted(() => ({
  practice: vi.fn(),
  draft: vi.fn(),
  control: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@tarojs/taro", () => ({ useDidShow: vi.fn(), useDidHide: vi.fn() }));
vi.mock("./ui", () => ({ loginPage: vi.fn() }));
vi.mock("../services/session", async () => ({
  session: (await import("./resource-test-support")).createTestSession(),
}));
vi.mock("../services/api", () => ({
  learningApi: { ...fake, items: async () => ({ items: [] }) },
}));
vi.mock("../services/tasks", () => ({ listTasks: async () => [], submitTask: fake.submit }));
vi.mock("../services/storage", async () => ({
  localStore: (await import("./draft-test-support")).createStore(),
}));
vi.mock("./task-view", () => ({ useTask: () => ({ active: false, snapshot: null }) }));
import { localStore } from "../services/storage";
import { session } from "../services/session";
import type { createTestSession } from "./resource-test-support";

let current: ReturnType<typeof usePractice>;
let view: ReturnType<typeof mount> | undefined;
function probe() {
  current = usePractice("session", undefined);
  return null;
}
async function load() {
  view = mount(createElement(probe));
  await act(async () => undefined);
}
beforeEach(() => {
  vi.clearAllMocks();
  (session as unknown as ReturnType<typeof createTestSession>).changeAccount("owner-a");
  localStore.clear();
});

it("hides mirrored practice state on logout without deleting the owner's saved draft", async () => {
  fake.practice.mockResolvedValue(practiceFixture());
  localStore.set("practice-draft:session", "private draft");
  await load();
  await act(async () =>
    (session as unknown as ReturnType<typeof createTestSession>).changeAccount(null),
  );
  expect(current.resource.data).toBeNull();
  expect(current.value).toBeNull();
  expect(current.answer).toBe("");
  expect(localStore.get("practice-draft:session")).toBe("private draft");
  await act(async () =>
    (session as unknown as ReturnType<typeof createTestSession>).changeAccount("owner-a"),
  );
  expect(current.value?.id).toBe("session");
  expect(current.answer).toBe("private draft");
});

it("resets another owner's practice mirrors and rejects a late installer from the old owner", async () => {
  fake.practice.mockResolvedValue(practiceFixture());
  localStore.set("practice-draft:session", "owner a draft");
  await load();
  const install = current.install;
  await act(async () =>
    (session as unknown as ReturnType<typeof createTestSession>).changeAccount("owner-b"),
  );
  act(() => install(savedPractice("sentence-creation")));
  expect(current.value).toBeNull();
  expect(current.answer).toBe("");
  expect(current.taskId).toBeNull();
  expect(localStore.get("practice-draft:session")).toBe("owner a draft");
});
afterEach(() => view?.unmount());

for (const type of ["sentence-creation", "dialogue"] as const) {
  it.each([
    { local: "B", confirmed: true, expected: "B" },
    { local: "A", confirmed: true, expected: "" },
    { local: "A", confirmed: false, expected: "A" },
    { local: "B", confirmed: false, expected: "B" },
  ])(
    `restores ${type} without deleting a newer draft: %j`,
    async ({ local, confirmed, expected }) => {
      const value = confirmed ? savedPractice(type) : practiceFixture(type);
      fake.practice.mockResolvedValue(value);
      localStore.set("practice-draft:session", local);
      const pending = {
        sessionId: "session",
        revision: 1,
        text: "A",
        attemptCount: 0,
        turnCount: 0,
      };
      localStore.set("practice-submitted:session", pending);
      await load();
      expect(current.answer).toBe(expected);
      expect(localStore.get("practice-draft:session")).toBe(expected || undefined);
      expect(localStore.get("practice-submitted:session")).toEqual(confirmed ? undefined : pending);
    },
  );

  it(`restores a distinct server draft after the submitted ${type} answer is confirmed`, async () => {
    const value = savedPractice(type);
    fake.practice.mockResolvedValue({
      ...value,
      workspace: { ...value.workspace, draft: "server B" },
    });
    localStore.set("practice-submitted:session", {
      sessionId: "session",
      revision: 1,
      text: "A",
      attemptCount: 0,
      turnCount: 0,
    });
    await load();
    expect(current.answer).toBe("server B");
    expect(localStore.get("practice-submitted:session")).toBeUndefined();
  });

  it(`keeps edits when a later ${type} response confirms the restored submission`, async () => {
    fake.practice.mockResolvedValue(practiceFixture(type));
    localStore.set("practice-draft:session", "A");
    localStore.set("practice-submitted:session", {
      sessionId: "session",
      revision: 1,
      text: "A",
      attemptCount: 0,
      turnCount: 0,
    });
    await load();
    act(() => current.changeAnswer("B"));
    act(() => current.install(savedPractice(type)));
    expect(current.answer).toBe("B");
    expect(localStore.get("practice-draft:session")).toBe("B");
    expect(localStore.get("practice-submitted:session")).toBeUndefined();
  });
}

it("blocks every draft-bearing operation for overlong input, then resumes after shortening", async () => {
  const value = practiceFixture();
  fake.practice.mockResolvedValue(value);
  fake.draft.mockResolvedValue(value);
  fake.control.mockResolvedValue(value);
  fake.submit.mockResolvedValue({ id: "task" });
  await load();
  const long = "x".repeat(4001);
  act(() => current.changeAnswer(long));
  await act(async () => {
    await current.submit();
    await current.syncDraft();
    await current.control("pause");
  });
  expect(current.answer).toBe(long);
  expect(localStore.get("practice-draft:session")).toBe(long);
  expect(localStore.get("practice-submitted:session")).toBeUndefined();
  expect(fake.submit).not.toHaveBeenCalled();
  expect(fake.draft).not.toHaveBeenCalled();
  expect(fake.control).not.toHaveBeenCalled();
  act(() => current.changeAnswer("x".repeat(4000)));
  await act(async () => {
    await current.syncDraft();
    await current.control("pause");
    await current.submit();
  });
  expect(fake.draft).toHaveBeenCalledOnce();
  expect(fake.control).toHaveBeenCalledOnce();
  expect(fake.submit).toHaveBeenCalledOnce();
});

it("resumes a remotely paused practice without sending or losing its overlong local draft", async () => {
  const value = practiceFixture();
  fake.practice.mockResolvedValue({ ...value, workspace: { ...value.workspace, phase: "paused" } });
  fake.control.mockResolvedValue(value);
  const long = "x".repeat(4001);
  localStore.set("practice-draft:session", long);
  await load();
  await act(async () => current.control("resume"));
  expect(fake.control).toHaveBeenCalledWith("session", { action: "resume", expectedRevision: 1 });
  expect(current.value?.workspace?.phase).toBe("active");
  expect(current.answer).toBe(long);
  expect(localStore.get("practice-draft:session")).toBe(long);
});

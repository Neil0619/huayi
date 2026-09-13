import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  contractFixtures,
  dailyPracticeQueueResponseSchema,
  learningItemDetailResponseSchema,
  practiceSessionResponseSchema,
  type DailyPracticeQueueResponse,
  type PracticeSession,
} from "@huayi/cloud-contracts";
import { PracticePage, type PracticePageApi } from "./practice-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const date = "2026-09-12T08:00:00.000Z";
const schedule = { consecutiveMastered: 0, dueAt: null, level: -1 as const };
const source = contractFixtures.confirmCandidatesResponse.results[0].item;
const items = ["first", "second"].map((id) => ({
  item: {
    id,
    type: source.type,
    content: source.content,
    systemAttributes: [...source.systemAttributes],
    tags: [...source.tags],
  },
  schedule,
}));
let root: Root | undefined;
beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/practice");
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
function fixture(count = 2) {
  const sessions = new Map<string, PracticeSession>();
  const rated = new Set<string>();
  const save = (value: unknown) => {
    const parsed = practiceSessionResponseSchema.parse(value);
    sessions.set(parsed.id, parsed);
    return parsed;
  };
  const get = (id: string) => {
    const result = sessions.get(id);
    if (!result) throw new Error("Missing practice");
    return result;
  };
  const queue = (): DailyPracticeQueueResponse => {
    const currentSession =
      [...sessions.values()].find(
        (session) =>
          session.workspace?.phase === "active" && session.items.some((item) => !item.rating),
      ) ?? null;
    return dailyPracticeQueueResponseSchema.parse({
      items: items.slice(0, count).filter((entry) => !rated.has(entry.item.id)),
      currentItems: currentSession
        ? currentSession.items.map((item) => items.find((entry) => entry.item.id === item.itemId))
        : [],
      currentSession,
      date: "2026-09-12",
      timezone: "Asia/Shanghai",
      dailyGoal: 5,
      completedToday: rated.size,
    });
  };
  const starts = new Map<string, string>();
  const workspace = {
    list: vi.fn(async () =>
      [...sessions.values()].filter((session) =>
        ["active", "paused"].includes(session.workspace?.phase ?? "active"),
      ),
    ),
    get: vi.fn(async (id: string) => get(id)),
    start: vi.fn<NonNullable<PracticePageApi["workspace"]>["start"]>(async (input, key) => {
      const previous = starts.get(key);
      if (previous) return get(previous);
      const id = `session-${sessions.size + 1}`;
      starts.set(key, id);
      return save({
        id,
        type: "sentence-creation",
        status: "active",
        prompt: `场景 ${input.itemId}`,
        items: [{ itemId: input.itemId, position: 0, scheduleBefore: schedule }],
        turns: [],
        revision: 1,
        createdAt: date,
        updatedAt: date,
        workspace: { phase: "active", mode: input.mode, draft: "", draftRevision: 0 },
      });
    }),
    draft: vi.fn<NonNullable<PracticePageApi["workspace"]>["draft"]>(async (id, input) => {
      const session = get(id);
      return save({
        ...session,
        workspace: {
          ...session.workspace,
          draft: input.draft,
          draftRevision: input.expectedDraftRevision + 1,
        },
      });
    }),
    control: vi.fn<NonNullable<PracticePageApi["workspace"]>["control"]>(async (id, input) => {
      const session = get(id);
      return save({
        ...session,
        revision: session.revision + 1,
        workspace: {
          ...session.workspace,
          phase:
            input.action === "end"
              ? "ended"
              : input.action === "pause"
                ? "paused"
                : input.action === "skip"
                  ? "skipped"
                  : "active",
          controlRevision: (session.workspace?.controlRevision ?? 0) + 1,
          draft: input.draft ?? session.workspace?.draft ?? "",
        },
      });
    }),
  };
  const api: PracticePageApi = {
    workspace,
    dailyQueue: vi.fn(async () => queue()),
    getLearningItem: vi.fn(async (id) =>
      learningItemDetailResponseSchema.parse({
        archivedAt: null,
        hasPracticeHistory: false,
        recentPractice: null,
        item: { ...source, id },
        schedule,
      }),
    ),
    startSentence: vi.fn(async (id) => {
      const session = [...sessions.values()].find(
        (entry) => entry.workspace?.phase === "active" && entry.items[0]?.itemId === id,
      );
      if (!session) throw new Error("Missing started session");
      return session;
    }),
    submitAttempt: vi.fn(async (id, input) =>
      save({
        ...get(id),
        status: "completed",
        revision: 2,
        finalFeedback: "表达准确，保留这次作答。",
        attempts: [
          {
            id: `attempt-${id}`,
            answer: input.answer,
            submittedAt: date,
            itemIds: [get(id).items[0]?.itemId],
            feedback: "表达准确，保留这次作答。",
          },
        ],
      }),
    ),
    rate: vi.fn<PracticePageApi["rate"]>(async (id, input) => {
      input.ratings.forEach((item) => rated.add(item.itemId));
      return save({
        ...get(id),
        revision: 3,
        items: get(id).items.map((item) => ({
          ...item,
          rating: input.ratings[0]?.rating,
          scheduleAfter: { consecutiveMastered: 1, dueAt: "2026-09-15T08:00:00.000Z", level: 0 },
        })),
      });
    }),
    finish: vi.fn(),
    startDialogue: vi.fn(),
    submitTurn: vi.fn(),
    retryAssistant: vi.fn(),
    retryFeedback: vi.fn(),
  };
  return { api, workspace, sessions, queue };
}
async function render(api: PracticePageApi) {
  const view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  let key = 0;
  await act(async () =>
    root?.render(<PracticePage api={api} idempotencyKey={() => `key-${++key}`} />),
  );
  return view;
}
function button(view: Element, label: string) {
  const result = [...view.querySelectorAll("button")].find((entry) => entry.textContent === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function click(view: Element, label: string) {
  await act(async () => button(view, label).click());
}
async function finish(view: Element) {
  const field = view.querySelector<HTMLTextAreaElement>("[name=answer]");
  if (!field) throw new Error("Missing answer");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      field,
      "To be frank, I agree.",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    view.querySelector<HTMLFormElement>("[data-attempt-form]")?.requestSubmit(),
  );
  await click(view, "掌握");
}

it("starts the first server-ordered item only on click, and ignores a second pending click", async () => {
  const f = fixture();
  const original = f.workspace.start.getMockImplementation();
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.workspace.start.mockImplementation(async (input, key) => {
    await wait;
    if (!original) throw new Error("Missing start");
    return original(input, key);
  });
  const view = await render(f.api);
  expect(f.sessions.size).toBe(0);
  await act(async () => {
    button(view, "开始今日练习").click();
    button(view, "开始今日练习").click();
  });
  await act(async () => release());
  expect(f.sessions.size).toBe(1);
  expect(view.querySelector(".practice-prompt")?.textContent).toContain("场景 first");
  expect(f.api.startSentence).toHaveBeenCalledTimes(1);
});

it("refreshes after self-rating and enters the next item instead of returning to the chooser", async () => {
  const f = fixture();
  const view = await render(f.api);
  await click(view, "开始今日练习");
  await finish(view);
  expect(f.sessions.size).toBe(1);
  expect(view.textContent).toContain("表达准确，保留这次作答");
  await click(view, "练习下一项");
  expect(view.querySelector(".practice-prompt")?.textContent).toContain("场景 second");
  expect(f.sessions.get("session-1")?.workspace?.phase).toBe("ended");
  expect(f.sessions.get("session-1")?.attempts?.[0]?.answer).toBe("To be frank, I agree.");
  expect(f.api.rate).toHaveBeenCalledTimes(1);
});

it("keeps completed feedback on a lost next-start response and reuses the same creation key", async () => {
  const f = fixture();
  const view = await render(f.api);
  await click(view, "开始今日练习");
  await finish(view);
  const original = f.workspace.start.getMockImplementation();
  f.workspace.start.mockImplementationOnce(async (input, key) => {
    await original?.(input, key);
    throw new TypeError("Response lost");
  });
  await click(view, "练习下一项");
  expect(view.textContent).toContain("表达准确，保留这次作答");
  expect(view.querySelector("[role=alert]")).not.toBeNull();
  await click(view, "练习下一项");
  expect(view.querySelector(".practice-prompt")?.textContent).toContain("场景 second");
  expect(f.sessions.size).toBe(2);
  expect(f.workspace.start.mock.calls[1]?.[1]).toBe(f.workspace.start.mock.calls[2]?.[1]);
  expect(f.api.rate).toHaveBeenCalledTimes(1);
});

it("keeps the last result, shows completion, and does not reinsert a completed deep-link item", async () => {
  const f = fixture(1);
  window.history.replaceState(null, "", "/practice?item=first");
  const view = await render(f.api);
  await click(view, "开始今日练习");
  await finish(view);
  expect(view.textContent).toContain("今天没有待练习内容");
  expect(view.textContent).toContain("表达准确，保留这次作答");
  expect(view.querySelector("[data-next-practice]")).toBeNull();
  await click(view, "返回今日总览");
  expect(view.textContent).toContain("今天没有待练习内容");
  expect(view.querySelector("[data-start-today]")).toBeNull();
  expect(f.sessions.size).toBe(1);
});

it("distinguishes saved self-rating from a failed queue refresh and retries without generation", async () => {
  const f = fixture();
  const view = await render(f.api);
  await click(view, "开始今日练习");
  vi.mocked(f.api.dailyQueue).mockRejectedValueOnce(new TypeError("Offline"));
  await finish(view);
  expect(view.textContent).toContain("自评已保存");
  expect(view.textContent).toContain("暂时无法检查待练内容");
  expect(view.querySelector("[data-next-practice]")).toBeNull();
  await click(view, "重新检查待练内容");
  expect(view.querySelector("[data-next-practice]")).not.toBeNull();
  expect(f.sessions.size).toBe(1);
  expect(f.api.rate).toHaveBeenCalledTimes(1);
});

it("promotes the latest saved practice on entry without generating or losing its draft", async () => {
  const f = fixture();
  const saved = await f.workspace.start({ itemId: "first", mode: "free" }, "saved");
  await f.workspace.draft(saved.id, {
    draft: "Keep this unfinished thought.",
    expectedDraftRevision: 0,
  });
  const view = await render(f.api);
  await act(async () => view.querySelector<HTMLButtonElement>("[data-resume-latest]")?.click());
  expect(view.querySelector<HTMLTextAreaElement>("[name=answer]")?.value).toBe(
    "Keep this unfinished thought.",
  );
  expect(f.api.startSentence).not.toHaveBeenCalled();
});

it("does not create the next practice until the previous workspace is safely ended", async () => {
  const f = fixture();
  const view = await render(f.api);
  await click(view, "开始今日练习");
  await finish(view);
  f.workspace.control.mockRejectedValueOnce(new TypeError("End not acknowledged"));
  await click(view, "练习下一项");
  expect(f.sessions.size).toBe(1);
  expect(view.textContent).toContain("表达准确，保留这次作答");
  expect(view.querySelector("[role=alert]")).not.toBeNull();
  await click(view, "练习下一项");
  expect(view.querySelector(".practice-prompt")?.textContent).toContain("场景 second");
  expect(f.api.rate).toHaveBeenCalledTimes(1);
});

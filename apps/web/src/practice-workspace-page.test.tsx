import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  contractFixtures,
  learningItemDetailResponseSchema,
  practiceSessionResponseSchema,
  type LearningTaskClient,
  type PracticeSession,
} from "@huayi/cloud-contracts";
import { PracticePage, type PracticePageApi } from "./practice-page.js";
import type { WebPracticeWorkspace } from "./practice-workspace-api.js";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const learned = contractFixtures.confirmCandidatesResponse.results[0];
const schedule = { consecutiveMastered: 0, dueAt: null, level: -1 as const };
const target = learningItemDetailResponseSchema.parse({
  archivedAt: null,
  hasPracticeHistory: false,
  item: learned.item,
  recentPractice: null,
  schedule,
});
const date = "2026-09-05T00:00:00.000Z";
const pending = practiceSessionResponseSchema.parse({
  id: "practice-pending",
  type: "sentence-creation",
  status: "awaiting-feedback",
  pendingGeneration: "sentence-prompt",
  items: [{ itemId: target.item.id, position: 0, scheduleBefore: schedule }],
  turns: [],
  revision: 1,
  createdAt: date,
  updatedAt: date,
  workspace: { phase: "active", mode: "guided", draft: "", draftRevision: 0 },
});
let root: Root | undefined;
beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/practice");
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
function setup() {
  let saved = structuredClone(pending);
  const workspace: WebPracticeWorkspace = {
    list: vi.fn(async () => [saved]),
    get: vi.fn(async () => saved),
    start: vi.fn(async () => saved),
    draft: vi.fn(async (_id, input) => {
      saved = {
        ...saved,
        workspace: {
          phase: "active",
          mode: "guided",
          ...saved.workspace,
          draft: input.draft,
          draftRevision: input.expectedDraftRevision + 1,
        },
      };
      return saved;
    }),
    control: vi.fn(async (_id, input) => {
      saved = practiceSessionResponseSchema.parse({
        ...saved,
        ...(input.action === "free"
          ? { prompt: "请在新场景中使用表达。", status: "active", pendingGeneration: undefined }
          : {}),
        revision: saved.revision + 1,
        workspace: {
          phase:
            input.action === "pause"
              ? "paused"
              : input.action === "skip"
                ? "skipped"
                : input.action === "end"
                  ? "ended"
                  : "active",
          mode: input.action === "free" ? "free" : "guided",
          draft: input.draft ?? "",
          draftRevision: (saved.workspace?.draftRevision ?? 0) + 1,
        },
      });
      return saved;
    }),
  };
  const tasks: LearningTaskClient = {
    submit: vi.fn(),
    list: vi.fn(async () => []),
    get: vi.fn(),
    cancel: vi.fn(),
    watch: vi.fn(),
  };
  const api: PracticePageApi = {
    workspace,
    tasks,
    dailyQueue: vi.fn(async () => ({
      currentItems: [{ item: target.item, schedule }],
      currentSession: saved,
      dailyGoal: 5,
      date: "2026-09-05",
      items: [],
      timezone: "UTC",
    })),
    getLearningItem: vi.fn(async () => target),
    finish: vi.fn(),
    rate: vi.fn(),
    retryAssistant: vi.fn(),
    retryFeedback: vi.fn(),
    startDialogue: vi.fn(),
    startSentence: vi.fn(),
    submitAttempt: vi.fn(),
    submitTurn: vi.fn(),
  };
  return { api, workspace, tasks };
}
async function render(api: PracticePageApi) {
  const element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () => root?.render(<PracticePage api={api} />));
  return element;
}
async function click(view: Element, label: string) {
  const button = [...view.querySelectorAll("button")].find((item) =>
    item.textContent?.startsWith(label),
  );
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}
async function type(view: Element, value: string) {
  const field = view.querySelector<HTMLTextAreaElement>("[name=answer]");
  if (!field) throw new Error("Missing draft input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      field,
      value,
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("starts from overview, offers free writing on prompt failure, and ends without rating or generation", async () => {
  const f = setup();
  const view = await render(f.api);
  expect(view.querySelector("[name=answer]")).toBeNull();
  await click(view, "继续上次练习");
  expect(view.textContent).toContain("题目尚未完成");
  await type(view, "I can use this expression.");
  await click(view, "改为自由造句");
  expect(view.querySelector<HTMLTextAreaElement>("[name=answer]")?.value).toBe(
    "I can use this expression.",
  );
  expect(view.textContent).not.toContain("题目尚未完成");
  expect(f.tasks.submit).not.toHaveBeenCalled();
  await click(view, "结束本次练习");
  expect(view.textContent).toContain("把读过的表达");
  expect(f.api.rate).not.toHaveBeenCalled();
});
it("restores the last keystroke after refresh even if the server draft save has not returned", async () => {
  const f = setup();
  f.workspace.draft = vi.fn(() => new Promise<PracticeSession>(() => undefined));
  const first = await render(f.api);
  await click(first, "继续上次练习");
  await type(first, "Last keystroke 😀");
  await act(async () => root?.unmount());
  const restored = await render(f.api);
  expect(restored.querySelector("[name=answer]")).toBeNull();
  await click(restored, "继续上次练习");
  expect(restored.querySelector<HTMLTextAreaElement>("[name=answer]")?.value).toBe(
    "Last keystroke 😀",
  );
  expect(f.tasks.submit).not.toHaveBeenCalled();
});
it("makes an explicitly chosen library item available without generating a task on entry", async () => {
  const f = setup();
  window.history.replaceState(null, "", `/practice?item=${target.item.id}`);
  const view = await render(f.api);
  expect(f.api.getLearningItem).toHaveBeenCalledWith(target.item.id);
  expect(view.textContent).toContain("自由造句");
  expect(f.tasks.submit).not.toHaveBeenCalled();
});
it("does not report an old draft save failure after switching mode has already saved that draft", async () => {
  const f = setup();
  let rejectSave: (error: Error) => void = () => undefined;
  f.workspace.draft = vi.fn(
    () =>
      new Promise<PracticeSession>((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const view = await render(f.api);
  await click(view, "继续上次练习");
  await type(view, "At least I can keep this draft.");
  await click(view, "改为自由造句");
  expect(f.workspace.draft).toHaveBeenCalled();
  await act(async () => rejectSave(new Error("Draft revision changed.")));
  expect(view.textContent).not.toContain("草稿尚未同步");
  expect(view.querySelector<HTMLTextAreaElement>("[name=answer]")?.value).toBe(
    "At least I can keep this draft.",
  );
  expect(f.tasks.submit).not.toHaveBeenCalled();
});

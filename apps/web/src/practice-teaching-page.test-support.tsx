import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { practiceTeachingDetailSchema } from "@huayi/cloud-contracts";
import { PracticePage } from "./practice-page.js";
import type { PracticePageApi } from "./practice-page-api.js";
import { practiceDate, practiceTarget, teachingFixture } from "./practice-teaching.test-support.js";

export function teachingPageFixture(initial = teachingFixture()) {
  let detail = initial;
  const save = (value: unknown) => (detail = practiceTeachingDetailSchema.parse(value));
  const workspace: NonNullable<PracticePageApi["workspace"]> = {
    list: vi.fn(async () => [detail.session]),
    get: vi.fn(async () => detail.session),
    start: vi.fn(async () => detail.session),
    draft: vi.fn(async (_id, input) => {
      save({
        ...detail,
        session: {
          ...detail.session,
          workspace: {
            ...detail.session.workspace,
            draft: input.draft,
            draftRevision: input.expectedDraftRevision + 1,
          },
        },
      });
      return detail.session;
    }),
    control: vi.fn(async (_id, input) => {
      save({
        ...detail,
        session: {
          ...detail.session,
          revision: detail.session.revision + 1,
          workspace: {
            ...detail.session.workspace,
            phase:
              input.action === "pause" ? "paused" : input.action === "end" ? "ended" : "active",
            controlRevision: (detail.session.workspace?.controlRevision ?? 0) + 1,
            ...(input.draft === undefined
              ? {}
              : { draft: input.draft, draftRevision: (input.expectedDraftRevision ?? 0) + 1 }),
          },
        },
      });
      return detail.session;
    }),
  };
  const teaching: NonNullable<PracticePageApi["teaching"]> = {
    get: vi.fn(async () => detail),
    act: vi.fn(async (_id, input) => {
      const state = detail.teaching;
      if (!state) throw new Error("Missing teaching");
      if (input.action === "reveal-hint")
        return save({
          ...detail,
          session: {
            ...detail.session,
            revision: detail.session.revision + 1,
            workspace: {
              ...detail.session.workspace,
              controlRevision: (detail.session.workspace?.controlRevision ?? 0) + 1,
            },
          },
          teaching: { ...state, round: { ...state.round, hintViewedAt: practiceDate } },
        });
      const previous = detail.session.attempts?.at(-1);
      return save({
        ...detail,
        session: {
          ...detail.session,
          status: "active",
          revision: detail.session.revision + 1,
          finalFeedback: undefined,
          workspace: {
            ...detail.session.workspace,
            controlRevision: (detail.session.workspace?.controlRevision ?? 0) + 1,
            draftRevision: (detail.session.workspace?.draftRevision ?? 0) + 1,
            draft: previous?.answer ?? "",
          },
        },
        teaching: {
          ...state,
          round: {
            ordinal: state.round.ordinal + 1,
            parentAttemptId: previous?.id,
            hintViewedAt: null,
          },
        },
      });
    }),
  };
  const api: PracticePageApi = {
    workspace,
    teaching,
    dailyQueue: vi.fn(async () => ({
      items: [{ item: practiceTarget.item, schedule: practiceTarget.schedule }],
      currentItems: [],
      currentSession: detail.session,
      date: "2026-09-13",
      timezone: "UTC",
      dailyGoal: 5,
    })),
    getLearningItem: vi.fn(async () => practiceTarget),
    startSentence: vi.fn(async () => detail.session),
    submitAttempt: vi.fn(),
    retryFeedback: vi.fn(),
    rate: vi.fn(),
    startDialogue: vi.fn(),
    submitTurn: vi.fn(),
    retryAssistant: vi.fn(),
    finish: vi.fn(),
  };
  return { api, workspace, teaching, save, current: () => detail };
}
export function findButton(view: Element, label: string) {
  const button = [...view.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button ${label}`);
  return button;
}
export async function press(view: Element, label: string) {
  await act(async () => findButton(view, label).click());
}
export async function renderPractice(
  api: PracticePageApi,
): Promise<{ view: HTMLDivElement; root: Root }> {
  const view = document.createElement("div");
  document.body.append(view);
  const root = createRoot(view);
  await act(async () => root.render(<PracticePage api={api} />));
  return { view, root };
}
export async function typeAnswer(view: Element, text: string) {
  const input = view.querySelector<HTMLTextAreaElement>("[name=answer]");
  if (!input) throw new Error("Missing answer");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

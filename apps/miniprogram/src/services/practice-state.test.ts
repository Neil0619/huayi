import { expect, it } from "vitest";
import type { PracticeSession } from "@huayi/cloud-contracts";
import { mergePractice } from "./practice-state";
const base: PracticeSession = {
  id: "session",
  revision: 3,
  createdAt: "2026-09-09T00:00:00Z",
  updatedAt: "2026-09-09T00:00:00Z",
  items: [
    {
      itemId: "item",
      position: 0,
      scheduleBefore: { level: -1, dueAt: null, consecutiveMastered: 0 },
    },
  ],
  type: "sentence-creation",
  status: "active",
  prompt: "自由造句",
  turns: [],
  workspace: {
    phase: "active",
    mode: "free",
    draft: "new answer",
    draftRevision: 2,
    controlRevision: 2,
  },
};
it("does not let late generation erase a newer rating or workspace control", () => {
  const rated: PracticeSession = {
    ...base,
    revision: 4,
    status: "completed",
    finalFeedback: "反馈",
    items: [
      {
        ...base.items[0],
        itemId: "item",
        position: 0,
        scheduleBefore: { level: -1, dueAt: null, consecutiveMastered: 0 },
        rating: "mastered",
        scheduleAfter: {
          level: 1,
          dueAt: "2026-09-10T00:00:00Z",
          consecutiveMastered: 1,
          lastRating: "mastered",
        },
      },
    ],
  };
  expect(mergePractice(rated, base)).toBe(rated);
  expect(
    mergePractice(base, {
      ...base,
      workspace: {
        phase: "paused",
        mode: "guided",
        draft: "old",
        draftRevision: 1,
        controlRevision: 1,
      },
    }).workspace,
  ).toEqual(base.workspace);
});

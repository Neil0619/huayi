import { expect, it } from "vitest";
import { practiceSessionResponseSchema } from "@huayi/cloud-contracts";
import { draftWasSaved } from "./practice-draft";
it("keeps submitted text until a new server attempt contains it, including failure and late-response cases", () => {
  const session = practiceSessionResponseSchema.parse({
    id: "session",
    revision: 1,
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
  });
  const pending = {
    sessionId: session.id,
    revision: session.revision,
    text: "My answer",
    attemptCount: session.attempts?.length ?? 0,
    turnCount: session.turns.length,
  };
  expect(draftWasSaved(pending, session)).toBe(false);
  const saved = {
    ...session,
    type: "sentence-creation" as const,
    revision: session.revision + 1,
    attempts: [
      ...(session.attempts ?? []),
      { id: "new", answer: "My answer", itemIds: ["item"], submittedAt: session.updatedAt },
    ],
  };
  expect(draftWasSaved(pending, saved)).toBe(true);
  expect(draftWasSaved({ ...pending, sessionId: "other" }, saved)).toBe(false);
});

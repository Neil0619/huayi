import { expect, it } from "vitest";
import {
  mergePracticeSession,
  practiceTeachingMatches,
  isResumablePractice,
} from "./practice-session-state.js";
import { teachingFixture } from "./practice-teaching.test-support.js";

it("never rolls a newer round back, while accepting its independently newer draft", () => {
  const old = teachingFixture(true).session;
  const current = {
    ...old,
    revision: 5,
    status: "active" as const,
    workspace: {
      ...old.workspace,
      mode: "guided" as const,
      phase: "active" as const,
      controlRevision: 2,
      draftRevision: 3,
      draft: "My new draft.",
    },
  };
  const stale = {
    ...old,
    workspace: {
      ...current.workspace,
      controlRevision: 0,
      draftRevision: 4,
      draft: "A saved newer draft.",
    },
  };
  const merged = mergePracticeSession(current, stale);
  expect(merged).toMatchObject({
    revision: 5,
    status: "active",
    workspace: { controlRevision: 2, draftRevision: 4, draft: "A saved newer draft." },
  });
});

it("does not replace a newer saved draft when model completion arrives", () => {
  const old = teachingFixture().session;
  const current = {
    ...old,
    workspace: {
      ...old.workspace,
      mode: "guided" as const,
      phase: "active" as const,
      draftRevision: 4,
      draft: "Do not lose this.",
    },
  };
  expect(mergePracticeSession(current, teachingFixture(true).session)).toMatchObject({
    status: "completed",
    workspace: { draftRevision: 4, draft: "Do not lose this." },
  });
});

it("only binds teaching to the same session and all three current versions", () => {
  const detail = teachingFixture();
  expect(practiceTeachingMatches(detail, detail.session)).toBe(true);
  expect(practiceTeachingMatches(detail, { ...detail.session, id: "other-session" })).toBe(false);
  expect(practiceTeachingMatches(detail, { ...detail.session, revision: 5 })).toBe(false);
  expect(
    practiceTeachingMatches(detail, {
      ...detail.session,
      workspace: {
        ...detail.session.workspace,
        mode: "guided",
        phase: "active",
        draft: "new",
        draftRevision: 1,
      },
    }),
  ).toBe(false);
});

it("keeps a rated active rewrite resumable and excludes a rated finished round", () => {
  const session = teachingFixture(true).session;
  const rated = {
    ...session,
    items: session.items.map((item) => ({ ...item, rating: "mastered" as const })),
  };
  expect(isResumablePractice({ ...rated, status: "active" })).toBe(true);
  expect(isResumablePractice(rated)).toBe(false);
  expect(
    isResumablePractice({
      ...rated,
      status: "active",
      workspace: {
        ...rated.workspace,
        mode: "guided",
        phase: "ended",
        draft: "",
        draftRevision: 0,
      },
    }),
  ).toBe(false);
});

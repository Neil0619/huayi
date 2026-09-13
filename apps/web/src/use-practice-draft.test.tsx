import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PracticeSession } from "@huayi/cloud-contracts";
import { usePracticeDraft } from "./use-practice-draft.js";
import { teachingFixture } from "./practice-teaching.test-support.js";
import type { WebPracticeWorkspace } from "./practice-workspace-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let draft: ReturnType<typeof usePracticeDraft>;
let view: HTMLDivElement;
const workspace: WebPracticeWorkspace = {
  start: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  control: vi.fn(),
  draft: vi.fn(),
};
function Harness({ session }: { session: PracticeSession }) {
  draft = usePracticeDraft(workspace, session);
  return <p>{draft.value}</p>;
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});
const saved = (text: string, revision: number): PracticeSession => ({
  ...teachingFixture().session,
  workspace: {
    phase: "active",
    mode: "guided",
    controlRevision: revision,
    draft: text,
    draftRevision: revision,
  },
});
const render = async (session: PracticeSession) =>
  act(async () => root.render(<Harness session={session} />));

it("adopts the same session's rewrite prefill when the learner has not typed", async () => {
  await render(saved("", 0));
  await render(saved("My original answer.", 1));
  expect(view.textContent).toBe("My original answer.");
  await act(async () => {
    await draft.flush();
  });
  expect(workspace.draft).not.toHaveBeenCalled();
});

it("preserves typing after a rewrite request and blocks silently overwriting a newer server draft", async () => {
  await render(saved("", 0));
  await act(async () => draft.setValue("A sentence typed while waiting."));
  await render(saved("The server prefill.", 1));
  expect(view.textContent).toBe("A sentence typed while waiting.");
  await act(async () => {
    await draft.flush();
  });
  expect(workspace.draft).not.toHaveBeenCalled();
  expect(draft.error).toContain("草稿");
});

it("ignores a late save acknowledgement after a newer server draft was installed", async () => {
  let resolve: (session: PracticeSession) => void = () => undefined;
  vi.mocked(workspace.draft).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render(saved("", 0));
  await act(async () => draft.setValue("An earlier typed answer."));
  let pending: Promise<unknown> = Promise.resolve();
  await act(async () => {
    pending = draft.flush();
  });
  await render(saved("A newer saved answer.", 3));
  await act(async () => {
    resolve(saved("An earlier typed answer.", 1));
    await pending;
  });
  expect(view.textContent).toBe("An earlier typed answer.");
  await act(async () => {
    await draft.flush();
  });
  expect(workspace.draft).toHaveBeenCalledTimes(1);
});

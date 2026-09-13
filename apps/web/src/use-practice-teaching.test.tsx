import { act, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { PracticeSession } from "@huayi/cloud-contracts";
import { teachingFixture } from "./practice-teaching.test-support.js";
import { usePracticeTeaching } from "./use-practice-teaching.js";
import { mergePracticeSession } from "./practice-session-state.js";
import type { WebPracticeTeaching } from "./practice-teaching-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
it("accepts an independently newer draft before re-reading a sidecar with the current business version", async () => {
  const base = teachingFixture();
  const initial = {
    ...base.session,
    revision: 12,
    workspace: {
      phase: "active" as const,
      mode: "guided" as const,
      controlRevision: 3,
      draftRevision: 4,
      draft: "Old saved draft.",
    },
  };
  const stale = {
    ...base,
    session: {
      ...initial,
      revision: 11,
      workspace: {
        ...initial.workspace,
        controlRevision: 2,
        draftRevision: 5,
        draft: "Newer saved draft.",
      },
    },
  };
  const fresh = {
    ...stale,
    session: {
      ...stale.session,
      revision: 12,
      workspace: { ...stale.session.workspace, controlRevision: 3 },
    },
  };
  const api: WebPracticeTeaching = {
    get: vi.fn().mockResolvedValueOnce(stale).mockResolvedValue(fresh),
    act: vi.fn(),
  };
  const observed: { revision: number; draft: number | undefined }[] = [];
  function Harness() {
    const [session, setSession] = useState<PracticeSession>(initial);
    const current = useRef(session);
    const install = useCallback((next: PracticeSession) => {
      current.current = mergePracticeSession(current.current, next);
      observed.push({
        revision: current.current.revision,
        draft: current.current.workspace?.draftRevision,
      });
      setSession(current.current);
      return current.current;
    }, []);
    const teaching = usePracticeTeaching(api, session, current, install, () => "local-key");
    return (
      <p>
        {session.revision}:{session.workspace?.draftRevision}:{session.workspace?.draft}:
        {teaching.data ? "matched" : "unavailable"}
      </p>
    );
  }
  const view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  await act(async () => root?.render(<Harness />));
  expect(observed[0]).toEqual({ revision: 12, draft: 5 });
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(view.textContent).toBe("12:5:Newer saved draft.:matched");
  expect(api.act).not.toHaveBeenCalled();
});

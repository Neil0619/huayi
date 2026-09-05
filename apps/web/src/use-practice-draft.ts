import { useEffect, useRef, useState } from "react";
import type { PracticeSession } from "@huayi/cloud-contracts";
import type { WebPracticeWorkspace } from "./practice-workspace-api.js";
import { readPracticeDraft, writePracticeDraft } from "./practice-draft-storage.js";

/** Serial saves use a separate draft revision so model completion cannot clobber typing. */
export function usePracticeDraft(
  workspace: WebPracticeWorkspace | undefined,
  session: PracticeSession | null,
) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const current = useRef<{ id: string; revision: number; saved: string; desired: string } | null>(
    null,
  );
  const operations = useRef(Promise.resolve());
  useEffect(() => {
    if (!session) {
      current.current = null;
      return;
    }
    if (current.current?.id === session.id) {
      if (session.workspace && session.workspace.draftRevision >= current.current.revision) {
        current.current.saved = session.workspace.draft;
        if (current.current.saved === current.current.desired) setError("");
      }
      current.current.revision = Math.max(
        current.current.revision,
        session.workspace?.draftRevision ?? 0,
      );
      return;
    }
    const saved = session.workspace?.draft ?? session.attempts?.at(-1)?.answer ?? "";
    const revision = session.workspace?.draftRevision ?? 0;
    const text = readPracticeDraft(session.id, revision) ?? saved;
    operations.current = Promise.resolve();
    current.current = { id: session.id, revision, saved, desired: text };
    setValue(text);
    setError("");
  }, [session]);
  const flush = () => {
    const state = current.current;
    if (!state || !workspace || state.saved === state.desired) return operations.current;
    operations.current = operations.current.then(async () => {
      if (state.saved === state.desired || current.current !== state) return;
      const text = state.desired;
      try {
        const saved = await workspace.draft(state.id, {
          draft: text,
          expectedDraftRevision: state.revision,
        });
        const revision = saved.workspace?.draftRevision ?? state.revision + 1;
        if (revision >= state.revision) {
          state.revision = revision;
          state.saved = text;
        }
        writePracticeDraft(state.id, state.desired, state.revision);
        if (current.current === state) setError("");
      } catch {
        if (current.current === state && state.saved !== state.desired)
          setError("草稿尚未同步，请稍后重试保存。");
      }
    });
    return operations.current;
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      void flush();
    }, 250);
    return () => {
      clearTimeout(timer);
      void flush();
    };
  }, [value, workspace]);
  return {
    value,
    error,
    flush,
    setValue(text: string) {
      const state = current.current;
      if (state) {
        state.desired = text;
        writePracticeDraft(state.id, text, state.revision);
      }
      setValue(text);
    },
  };
}

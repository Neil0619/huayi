import { useEffect, useRef, useState } from "react";
import type { PracticeSession } from "@huayi/cloud-contracts";
import type { WebPracticeWorkspace } from "./practice-workspace-api.js";
import {
  clearPracticeDraft,
  readPracticeDraft,
  writePracticeDraft,
} from "./practice-draft-storage.js";

interface DraftState {
  id: string;
  revision: number;
  saved: string;
  desired: string;
  conflict: boolean;
  editable: boolean;
}
const conflictMessage = "草稿在另一个操作中更新了。本地文字已保留，请选择要使用的版本。";

/** Serial saves retain unsaved typing; an external version needs an explicit choice. */
export function usePracticeDraft(
  workspace: WebPracticeWorkspace | undefined,
  session: PracticeSession | null,
  onSaved?: (session: PracticeSession) => void,
) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const current = useRef<DraftState | null>(null);
  const operations = useRef(Promise.resolve());
  const callback = useRef(onSaved);
  callback.current = onSaved;
  const persist = (state: DraftState) => {
    if (state.saved === state.desired && !state.conflict) clearPracticeDraft(state.id);
    else writePracticeDraft(state.id, state.desired, state.revision, state.conflict);
  };
  useEffect(() => {
    return () => {
      current.current = null;
    };
  }, [workspace]);
  useEffect(() => {
    if (!session) {
      current.current = null;
      setValue("");
      setError("");
      setConflict(false);
      return;
    }
    const saved = session.workspace?.draft ?? session.attempts?.at(-1)?.answer ?? "";
    const revision = session.workspace?.draftRevision ?? 0;
    const editable = session.status === "active" || Boolean(session.pendingGeneration);
    const state = current.current;
    if (state?.id === session.id) {
      state.editable = editable;
      if (revision <= state.revision) return;
      const dirty = state.desired !== state.saved;
      if (dirty && saved !== state.desired && saved !== state.saved) {
        state.conflict = true;
        setConflict(true);
        setError(conflictMessage);
      } else if (!dirty || saved === state.desired) {
        state.desired = saved;
        state.conflict = false;
        setValue(saved);
        setConflict(false);
        setError("");
      }
      state.saved = saved;
      state.revision = revision;
      persist(state);
      return;
    }
    const local = editable ? readPracticeDraft(session.id, revision) : null;
    const text = local?.text ?? saved;
    const conflicted = local !== null && local.conflict && text !== saved;
    operations.current = Promise.resolve();
    current.current = {
      id: session.id,
      revision,
      saved,
      desired: text,
      conflict: conflicted,
      editable,
    };
    setValue(text);
    setConflict(conflicted);
    setError(conflicted ? conflictMessage : "");
  }, [session, workspace]);
  const flush = () => {
    const state = current.current;
    if (!state || !workspace || state.saved === state.desired || state.conflict || !state.editable)
      return operations.current;
    operations.current = operations.current.then(async () => {
      if (
        state.saved === state.desired ||
        state.conflict ||
        !state.editable ||
        current.current !== state
      )
        return;
      const text = state.desired;
      const revision = state.revision;
      try {
        const saved = await workspace.draft(state.id, {
          draft: text,
          expectedDraftRevision: revision,
        });
        if (current.current !== state || saved.id !== state.id) return;
        const remote = saved.workspace;
        if (remote && remote.draftRevision > state.revision && !state.conflict) {
          state.revision = remote.draftRevision;
          state.saved = remote.draft;
          if (state.desired === text) {
            state.desired = remote.draft;
            setValue(remote.draft);
          }
          callback.current?.(saved);
        }
        persist(state);
        if (!state.conflict) setError("");
      } catch {
        if (current.current === state && state.saved !== state.desired && !state.conflict)
          setError("草稿尚未同步，请稍后重试保存。");
      }
    });
    return operations.current;
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      void flush();
    }, 250);
    return () => clearTimeout(timer);
  }, [value, workspace]);
  return {
    value,
    error,
    conflict,
    flush,
    snapshot() {
      const state = current.current;
      return {
        value: state?.desired ?? value,
        revision: state?.revision ?? 0,
        dirty: state ? state.saved !== state.desired : false,
        conflict: state?.conflict ?? false,
      };
    },
    resolveConflict(choice: "local" | "saved") {
      const state = current.current;
      if (!state) return;
      if (choice === "saved") state.desired = state.saved;
      state.conflict = false;
      setValue(state.desired);
      setConflict(false);
      setError("");
      persist(state);
      if (choice === "local") void flush();
    },
    setValue(text: string) {
      const state = current.current;
      if (state) {
        state.desired = text;
        persist(state);
      }
      setValue(text);
    },
  };
}

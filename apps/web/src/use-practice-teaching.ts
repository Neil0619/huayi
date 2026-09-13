import { useCallback, useEffect, useRef, useState } from "react";
import {
  LearningTaskError,
  type PracticeSession,
  type PracticeTeachingAction,
  type PracticeTeachingDetail,
} from "@huayi/cloud-contracts";
import type { WebPracticeTeaching } from "./practice-teaching-api.js";
import { mergePracticeSession, practiceTeachingMatches } from "./practice-session-state.js";

export function usePracticeTeaching(
  api: WebPracticeTeaching | undefined,
  session: PracticeSession | null,
  current: { current: PracticeSession | null },
  install: (session: PracticeSession) => PracticeSession,
  key: () => string,
) {
  const [detail, setDetail] = useState<PracticeTeachingDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const cached = useRef<PracticeTeachingDetail | null>(null);
  const pending = useRef<{ id: string; input: PracticeTeachingAction; key: string } | null>(null);
  const accept = useCallback(
    (next: PracticeTeachingDetail, id: string) => {
      const active = current.current;
      if (!active || active.id !== id || next.session.id !== id)
        throw new LearningTaskError("invalid_response");
      const merged = mergePracticeSession(active, next.session);
      install(merged);
      if (!practiceTeachingMatches(next, merged)) throw new LearningTaskError("revision_conflict");
      cached.current = next;
      setDetail(next);
      if (pending.current?.id === id && merged.revision > pending.current.input.expectedRevision)
        pending.current = null;
      setError("");
    },
    [current, install],
  );
  const refresh = useCallback(async () => {
    const active = current.current;
    if (!api || active?.type !== "sentence-creation") return;
    const ticket = ++revision.current;
    setLoading(true);
    setError("");
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const next = await api.get(active.id);
        if (ticket !== revision.current) return;
        try {
          accept(next, active.id);
          break;
        } catch (cause) {
          if (
            attempt > 0 ||
            !(cause instanceof LearningTaskError) ||
            cause.code !== "revision_conflict"
          )
            throw cause;
        }
      }
    } catch {
      if (ticket === revision.current)
        setError("练习详情暂时未能读取。已保存的作答和反馈仍可查看。");
    } finally {
      if (ticket === revision.current) setLoading(false);
    }
  }, [api, current, accept]);
  useEffect(() => {
    if (!api || session?.type !== "sentence-creation") {
      cached.current = null;
      setDetail(null);
      setError("");
      setLoading(false);
      pending.current = null;
    } else if (!cached.current || !practiceTeachingMatches(cached.current, session)) void refresh();
    return () => {
      revision.current += 1;
    };
  }, [api, session?.id, session?.revision, session?.workspace?.controlRevision, refresh]);
  const data = detail && session && practiceTeachingMatches(detail, session) ? detail : null;
  return {
    data,
    loading,
    error,
    refresh,
    async act(input: PracticeTeachingAction) {
      const active = current.current;
      if (!api || !active || !cached.current || !practiceTeachingMatches(cached.current, active))
        return;
      let operation = pending.current;
      if (!operation || operation.id !== active.id || operation.input.action !== input.action) {
        operation = { id: active.id, input, key: key() };
        pending.current = operation;
      }
      const ticket = ++revision.current;
      setError("");
      try {
        const response = await api.act(operation.id, operation.input, operation.key);
        if (ticket !== revision.current) return;
        accept(response, operation.id);
        pending.current = null;
      } catch {
        if (ticket === revision.current) {
          // A lost action response is reconciled by a read; never regenerate feedback here.
          await refresh();
          if (pending.current) setError("这次操作尚未确认。可重新读取练习详情，或重试同一步操作。");
        }
      }
    },
  };
}

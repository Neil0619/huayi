import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  LearningTaskError,
  type LearningTaskSnapshot,
  type PracticeReferenceDetail,
  type PracticeReferenceRequest,
  type PracticeSession,
} from "@huayi/cloud-contracts";
import type { PracticePageApi } from "./practice-page-api.js";
import { learningTaskFeedback } from "./learning-task-feedback.js";

interface Options {
  api: PracticePageApi;
  session: PracticeSession | null;
  current: RefObject<PracticeSession | null>;
  ordinal: number;
  task: LearningTaskSnapshot | null;
  key(): string;
  install(session: PracticeSession): PracticeSession;
  subscribe(task: LearningTaskSnapshot): Promise<PracticeSession>;
}
function identity(session: PracticeSession | null, ordinal: number) {
  return session?.type === "sentence-creation" &&
    session.status === "active" &&
    session.workspace?.phase === "active"
    ? JSON.stringify([
        session.id,
        session.prompt,
        session.workspace.mode,
        ordinal,
        session.items[0]?.learningItemDeletedAt,
      ])
    : "";
}

/** Draft revisions never invalidate a reference or trigger its generation. */
export function usePracticeReference(options: Options) {
  const { api, session, ordinal, task } = options;
  const latest = useRef(options);
  latest.current = options;
  const stamp = identity(session, ordinal);
  const currentStamp = useRef(stamp);
  currentStamp.current = stamp;
  const mounted = useRef(true);
  const reads = useRef(0);
  const pending = useRef<{ stamp: string; input: PracticeReferenceRequest; key: string } | null>(
    null,
  );
  const operation = useRef<{ stamp: string; controller: AbortController } | null>(null);
  const [saved, setSaved] = useState<{ stamp: string; detail: PracticeReferenceDetail } | null>(
    null,
  );
  const [opened, setOpened] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reads.current += 1;
      operation.current?.controller.abort();
    };
  }, [api]);
  const refresh = useCallback(async () => {
    const id = latest.current.current.current?.id;
    const captured = currentStamp.current;
    if (!api.reference || !id || !captured) return null;
    const token = ++reads.current;
    const detail = await api.reference.get(id);
    if (!mounted.current || currentStamp.current !== captured) return null;
    if (token === reads.current)
      setSaved((previous) =>
        previous?.stamp === captured && previous.detail.controlRevision > detail.controlRevision
          ? previous
          : { stamp: captured, detail },
      );
    return detail;
  }, [api]);
  useEffect(() => {
    setOpened("");
    setError("");
    if (pending.current?.stamp !== stamp) pending.current = null;
    if (operation.current?.stamp !== stamp) {
      operation.current?.controller.abort();
      operation.current = null;
      setLoading(false);
    }
  }, [stamp]);
  useEffect(() => {
    let live = true;
    void refresh().catch(() => {
      if (live) setError("暂时无法读取参考表达，请重试。");
    });
    return () => {
      live = false;
      reads.current += 1;
    };
  }, [
    refresh,
    stamp,
    session?.revision,
    session?.workspace?.controlRevision,
    task?.id,
    task?.state,
  ]);
  const detail = saved?.stamp === stamp ? saved.detail : null;
  const expanded = Boolean(stamp && opened === stamp);
  const toggle = async () => {
    if (expanded) {
      setOpened("");
      return;
    }
    if (operation.current || !stamp || !api.reference || !api.tasks) return;
    const running = { stamp, controller: new AbortController() };
    operation.current = running;
    setLoading(true);
    setError("");
    const captured = stamp;
    const alive = () =>
      mounted.current &&
      operation.current === running &&
      currentStamp.current === captured &&
      identity(latest.current.current.current, latest.current.ordinal) === captured;
    try {
      let current = await refresh();
      if (!alive() || !current || current.availability !== "available") return;
      if (!current.ready) {
        const request = pending.current ?? {
          stamp: captured,
          key: latest.current.key(),
          input: {
            expectedRevision: current.revision,
            expectedControlRevision: current.controlRevision,
            ordinal: current.ordinal,
          },
        };
        pending.current = request;
        const snapshot = await api.tasks.submit(
          {
            version: 2,
            kind: "sentence-reference",
            sessionId: current.sessionId,
            input: request.input,
          },
          request.key,
          running.controller.signal,
        );
        if (!alive()) return;
        await latest.current.subscribe(snapshot);
        if (!alive()) return;
        pending.current = null;
        current = await refresh();
        if (!alive() || !current) return;
      }
      if (!current.ready) throw new LearningTaskError("outcome_unknown");
      if (!current.reference) {
        current = await api.reference.reveal(
          current.sessionId,
          {
            expectedRevision: current.revision,
            expectedControlRevision: current.controlRevision,
            ordinal: current.ordinal,
          },
          latest.current.key(),
        );
        if (!alive()) return;
      }
      // A successful GET may recover a reveal whose committed response was lost.
      // Synchronize its revision/hint fact before enabling an answer submission.
      if (api.workspace) {
        const next = await api.workspace.get(current.sessionId);
        if (!alive()) return;
        latest.current.install(next);
      }
      if (alive()) {
        setSaved({ stamp: captured, detail: current });
        setOpened(captured);
      }
    } catch (cause) {
      if (alive()) {
        if (
          cause instanceof LearningTaskError &&
          !["network_error", "outcome_unknown", "invalid_response"].includes(cause.code)
        )
          pending.current = null;
        setError(learningTaskFeedback(cause, "practice"));
      }
    } finally {
      if (operation.current === running) {
        operation.current = null;
        if (mounted.current) setLoading(false);
      }
    }
  };
  return {
    available: Boolean(api.reference && api.tasks && stamp),
    detail,
    expanded,
    loading,
    error,
    toggle,
  };
}

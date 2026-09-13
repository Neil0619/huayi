import { measureLearningPresentation } from "./learning-ui-timing.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DailyPracticeQueueResponse,
  type LearningItemDetailResponse,
  type LearningTaskCommand,
  type LearningTaskSnapshot,
  type PracticeSession,
} from "@huayi/cloud-contracts";
import type { PracticePageApi } from "./practice-page-api.js";
import { usePracticeDraft } from "./use-practice-draft.js";
import { pauseOtherPractice } from "./pause-other-practice.js";
import { usePracticeNavigation } from "./use-practice-navigation.js";
import { learningTaskFeedback } from "./learning-task-feedback.js";

import { createPracticeApiScope } from "./practice-api-scope.js";
import {
  isResumablePractice,
  mergePracticeSession,
  practiceGenerationStatus,
} from "./practice-session-state.js";
import { usePracticeTeaching } from "./use-practice-teaching.js";
import { usePracticeReference } from "./use-practice-reference.js";

export function usePracticeWorkspace(source: PracticePageApi, key: () => string) {
  const scope = useMemo(() => createPracticeApiScope(source), [source]);
  const api = scope.api;
  useEffect(() => {
    scope.activate();
    return () => scope.deactivate();
  }, [scope]);
  const [hintPolicy, setHintPolicy] = useState<"shown" | "on-demand">("shown");
  const [queue, setQueue] = useState<DailyPracticeQueueResponse | null>(null);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [resumable, setResumable] = useState<PracticeSession[]>([]);
  const [detail, setDetail] = useState<LearningItemDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [task, setTask] = useState<LearningTaskSnapshot | null>(null);
  const [preview, setPreview] = useState("");
  const activeSession = useRef<PracticeSession | null>(null);
  const subscription = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mutation = useRef(false);
  const requestedItem = useRef(new URLSearchParams(window.location.search).get("item"));
  const install = useCallback((next: PracticeSession) => {
    const merged = mergePracticeSession(activeSession.current, next);
    activeSession.current = merged;
    setSession(merged);
    return merged;
  }, []);
  const draft = usePracticeDraft(api.workspace, session, (saved) => {
    if (activeSession.current?.id === saved.id) install(saved);
  });
  const teaching = usePracticeTeaching(api.teaching, session, activeSession, install, key);
  const load = useCallback(async () => {
    const alive = scope.checkpoint();
    setLoading(true);
    setError("");
    try {
      const response = await api.dailyQueue();
      const requested = requestedItem.current;
      if (requested && !response.items.some((entry) => entry.item.id === requested)) {
        const chosen = await api.getLearningItem(requested).catch(() => null);
        if (chosen && chosen.archivedAt === null)
          response.items.unshift({ item: chosen.item, schedule: chosen.schedule });
      }
      requestedItem.current = null;
      setQueue(response);
      const saved = api.workspace
        ? await api.workspace.list()
        : response.currentSession
          ? [response.currentSession]
          : [];
      setResumable(saved.filter(isResumablePractice));
      return response.currentSession;
    } catch {
      if (alive()) setError("暂时无法载入今日练习，请检查网络后重试。");
      return null;
    } finally {
      if (alive()) setLoading(false);
    }
  }, [api, scope]);
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
      subscription.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    setDetail(null);
    if (session?.type !== "sentence-creation") return;
    let live = true;
    const id = session.items[0]?.itemId;
    if (id)
      void api
        .getLearningItem(id)
        .then((value) => {
          if (live) setDetail(value);
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, session?.id, session?.status]);
  const subscribe = async (snapshot: LearningTaskSnapshot): Promise<PracticeSession> => {
    const client = api.tasks;
    if (!client) throw new Error("Background learning is unavailable.");
    subscription.current?.abort();
    const controller = new AbortController();
    subscription.current = controller;
    const current = ++generation.current;
    setTask(snapshot);
    setPreview("");
    let latest: PracticeSession | null = activeSession.current;
    try {
      for await (const event of client.watch(snapshot.id, controller.signal, (next) => {
        if (current === generation.current) setTask(next);
      })) {
        if (current !== generation.current) break;
        if (event.type === "practice.updated") {
          latest = install(event.session);
        }
        measureLearningPresentation("practice", performance.now());
        if (
          event.type === "practice.preview" &&
          (!api.teaching || activeSession.current?.type === "dialogue")
        )
          setPreview((text) => (text + event.text).slice(0, 16000));
      }
      if (current === generation.current) {
        setTask(null);
        setPreview("");
        setStatus(practiceGenerationStatus(snapshot.kind, latest));
      }
    } catch (cause) {
      if (current === generation.current && !controller.signal.aborted) {
        setTask(null);
        setError(learningTaskFeedback(cause, "practice"));
      }
      throw cause;
    }
    controller.signal.throwIfAborted();
    if (!latest) throw new Error("Practice has not started yet.");
    return latest;
  };
  const reference = usePracticeReference({
    api,
    session,
    current: activeSession,
    ordinal: teaching.data?.teaching?.round.ordinal ?? session?.attempts?.length ?? 0,
    task,
    key,
    install,
    subscribe,
  });
  const run = async (
    command: LearningTaskCommand,
    fallback: () => Promise<PracticeSession>,
    prepare?: () => Promise<void>,
  ) => {
    if (mutation.current) throw new Error("Practice operation is already pending.");
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await prepare?.();
      if (!api.tasks) {
        const result = await fallback();
        install(result);
        return result;
      }
      const snapshot = await api.tasks.submit(command, key());
      return subscribe(snapshot);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const act = async (operation: () => Promise<unknown>) => {
    if (mutation.current) return;
    const alive = scope.checkpoint();
    if (!alive()) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      if (alive()) setError(learningTaskFeedback(cause, "practice"));
    } finally {
      mutation.current = false;
      if (alive()) setBusy(false);
    }
  };
  const navigation = usePracticeNavigation({
    api,
    key,
    session,
    current: activeSession,
    draft,
    hintPolicy: teaching.data?.teaching?.hintPolicy ?? hintPolicy,
    act,
    install,
    subscribe,
    setQueue,
    setStatus,
    stopWatching() {
      generation.current += 1;
      subscription.current?.abort();
      setTask(null);
      setPreview("");
    },
    async showOverview() {
      activeSession.current = null;
      setSession(null);
      await load();
    },
  });
  const resume = (saved: PracticeSession) =>
    act(async () => {
      let next = api.workspace ? await api.workspace.get(saved.id) : saved;
      await pauseOtherPractice(api.workspace, key, next.id);
      if (next.workspace?.phase === "paused" && api.workspace)
        next = await api.workspace.control(
          next.id,
          {
            action: "resume",
            expectedRevision: next.revision,
            expectedControlRevision: next.workspace?.controlRevision ?? 0,
          },
          key(),
        );
      install(next);
      setStatus("已恢复这次练习。");
      if (api.tasks) {
        const jobs = await api.tasks.list();
        const running = jobs.find(
          (job) =>
            ["queued", "running", "cancelling"].includes(job.state) &&
            (job.subjectId === next.id ||
              (job.kind === "sentence-start" && job.subjectId === next.items[0]?.itemId)),
        );
        if (running) void subscribe(running).catch(() => undefined);
      }
    });
  const submit = () =>
    act(async () => {
      await draft.flush();
      const current = activeSession.current;
      const text = draft.snapshot();
      if (!current || text.value.trim() === "") return;
      if (text.conflict || (api.workspace && text.dirty))
        throw new Error("Draft is not synchronized.");
      const input = { answer: text.value, expectedRevision: current.revision };
      if (api.tasks) {
        const snapshot = await api.tasks.submit(
          { version: 2, kind: "sentence-submit", sessionId: current.id, input },
          key(),
        );
        void subscribe(snapshot).catch(() => undefined);
      } else {
        try {
          install(await api.submitAttempt(current.id, input, key()));
        } catch (cause) {
          const recovered = await load();
          if (recovered) install(recovered);
          throw cause;
        }
      }
    });
  const retry = () =>
    act(async () => {
      const current = activeSession.current;
      if (!current) return;
      const itemId = current.items[0]?.itemId ?? "";
      const attempt = current.attempts?.at(-1);
      const command: LearningTaskCommand = attempt
        ? {
            version: 2,
            kind: "sentence-feedback-retry",
            sessionId: current.id,
            attemptId: attempt.id,
            input: { expectedRevision: current.revision },
          }
        : { version: 2, kind: "sentence-start", sessionId: current.id, input: { itemId } };
      if (api.tasks) {
        const snapshot = await api.tasks.submit(command, key());
        void subscribe(snapshot).catch(() => undefined);
      } else
        install(
          attempt
            ? await api.retryFeedback(
                current.id,
                attempt.id,
                { expectedRevision: current.revision },
                key(),
              )
            : await api.startSentence(itemId, key()),
        );
    });
  const rate = (rating: "effortful" | "forgot" | "mastered") =>
    act(async () => {
      const current = activeSession.current;
      const itemId = current?.items[0]?.itemId;
      if (!current || !itemId) return;
      install(
        await api.rate(
          current.id,
          { expectedRevision: current.revision, ratings: [{ itemId, rating }] },
          key(),
        ),
      );
      setStatus("自评已保存，复习排期已更新。");
    });
  const cancelTask = () =>
    act(async () => {
      if (task && api.tasks) {
        setTask(await api.tasks.cancel(task.id));
        setStatus("已请求停止，正在等待服务器确认。");
      }
    });
  const dialogueApi: PracticePageApi = {
    ...api,
    startDialogue: async (itemIds, idempotencyKey) => {
      const current = activeSession.current;
      const retrying =
        current?.type === "dialogue" && current.pendingGeneration === "dialogue-start";
      return run(
        { version: 2, kind: "dialogue-start", input: { itemIds } },
        () => api.startDialogue(itemIds, idempotencyKey),
        () => pauseOtherPractice(api.workspace, key, retrying ? current.id : undefined),
      );
    },
    submitTurn: (sessionId, input, idempotencyKey) =>
      run({ version: 2, kind: "dialogue-turn", sessionId, input }, () =>
        api.submitTurn(sessionId, input, idempotencyKey),
      ),
    finish: (sessionId, input, idempotencyKey) =>
      run({ version: 2, kind: "dialogue-finish", sessionId, input }, () =>
        api.finish(sessionId, input, idempotencyKey),
      ),
    retryAssistant: (sessionId, input, idempotencyKey) =>
      run({ version: 2, kind: "dialogue-retry", sessionId, input }, () =>
        api.retryAssistant(sessionId, input, idempotencyKey),
      ),
  };
  return {
    queue,
    session,
    teaching,
    reference,
    hintPolicy,
    setHintPolicy,
    teachingAction: (action: "rewrite" | "reveal-hint") =>
      act(async () => {
        const current = activeSession.current;
        const data = teaching.data?.teaching;
        if (!current?.workspace || !data || draft.snapshot().conflict) return;
        setStatus("");
        await teaching.act(
          action === "rewrite"
            ? {
                action,
                expectedRevision: current.revision,
                expectedControlRevision: current.workspace.controlRevision ?? 0,
                expectedDraftRevision: draft.snapshot().revision,
              }
            : {
                action,
                expectedRevision: current.revision,
                expectedControlRevision: current.workspace.controlRevision ?? 0,
                ordinal: data.round.ordinal,
              },
        );
      }),
    resumable,
    detail,
    loading,
    busy,
    error: error || draft.error,
    status,
    task,
    preview,
    draft,
    load,
    install,
    ...navigation,
    resume,
    submit,
    retry,
    rate,
    dialogueApi,
    cancelTask,
  };
}

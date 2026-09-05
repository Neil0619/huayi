import { measureLearningPresentation } from "./learning-ui-timing.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LearningTaskError,
  type DailyPracticeQueueResponse,
  type LearningItemDetailResponse,
  type LearningTaskCommand,
  type LearningTaskSnapshot,
  type PracticeSession,
  type PracticeWorkspaceControl,
} from "@huayi/cloud-contracts";
import type { PracticePageApi } from "./practice-page-api.js";
import { usePracticeDraft } from "./use-practice-draft.js";

export function usePracticeWorkspace(api: PracticePageApi, key: () => string) {
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
  const draft = usePracticeDraft(api.workspace, session);
  const install = useCallback((next: PracticeSession) => {
    activeSession.current = next;
    setSession(next);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.dailyQueue();
      const requested = new URLSearchParams(window.location.search).get("item");
      if (requested && !response.items.some((entry) => entry.item.id === requested)) {
        const chosen = await api.getLearningItem(requested).catch(() => null);
        if (chosen && chosen.archivedAt === null)
          response.items.unshift({ item: chosen.item, schedule: chosen.schedule });
      }
      setQueue(response);
      const saved = api.workspace
        ? await api.workspace.list()
        : response.currentSession
          ? [response.currentSession]
          : [];
      setResumable(
        saved.filter((item) => item.items.some((target) => target.rating === undefined)),
      );
      return response.currentSession;
    } catch {
      setError("暂时无法载入今日练习，请检查网络后重试。");
      return null;
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
      subscription.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    setDetail(null);
    if (session?.status !== "completed" || session.type !== "sentence-creation") return;
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
          latest = event.session;
          install(event.session);
        }
        measureLearningPresentation("practice", performance.now());
        if (event.type === "practice.preview")
          setPreview((text) => (text + event.text).slice(0, 16000));
      }
      if (current === generation.current) {
        setTask(null);
        setPreview("");
        setStatus(
          latest?.pendingGeneration
            ? "题目尚未完成，可以重试或自由造句。"
            : latest?.status === "completed"
              ? "反馈已完成，请自评。"
              : "题目已生成，可以开始作答。",
        );
      }
    } catch (cause) {
      if (current === generation.current && !controller.signal.aborted) {
        setTask(null);
        setError(
          `生成未完成，已保存的内容和草稿会保留。${cause instanceof LearningTaskError && cause.diagnosticId ? `诊断编号：${cause.diagnosticId}` : ""}`,
        );
      }
    }
    controller.signal.throwIfAborted();
    if (!latest) throw new Error("Practice has not started yet.");
    return latest;
  };
  const run = async (command: LearningTaskCommand, fallback: () => Promise<PracticeSession>) => {
    setError("");
    if (!api.tasks) {
      const result = await fallback();
      install(result);
      return result;
    }
    const snapshot = await api.tasks.submit(command, key());
    return subscribe(snapshot);
  };
  const act = async (operation: () => Promise<unknown>) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch {
      setError("操作未完成，当前内容已保留，可以重试。");
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const start = (itemId: string, mode: "guided" | "free" = "guided") =>
    act(async () => {
      if (api.workspace) {
        const existing = resumable.find((item) => (item.workspace?.phase ?? "active") === "active");
        if (existing)
          await api.workspace.control(
            existing.id,
            {
              action: "pause",
              expectedRevision: existing.revision,
              expectedControlRevision: existing.workspace?.controlRevision ?? 0,
            },
            key(),
          );
        const ready = await api.workspace.start({ itemId, mode }, key());
        install(ready);
        if (mode === "free") {
          setStatus("自由造句：请在新场景中使用这条表达或句型。");
          return;
        }
        if (api.tasks) {
          const snapshot = await api.tasks.submit(
            { version: 2, kind: "sentence-start", sessionId: ready.id, input: { itemId } },
            key(),
          );
          void subscribe(snapshot).catch(() => undefined);
          return;
        }
      }
      const next = await api.startSentence(itemId, key());
      install(next);
      setStatus(
        next.pendingGeneration
          ? "题目尚未完成，可以重试或自由造句。"
          : "题目已生成，可以开始作答。",
      );
    });
  const control = (action: PracticeWorkspaceControl["action"]) =>
    act(async () => {
      const current = activeSession.current;
      if (!current) return;
      void draft.flush();
      if (api.workspace) {
        const latest = await api.workspace.get(current.id);
        const next = await api.workspace.control(
          current.id,
          {
            action,
            expectedRevision: latest.revision,
            expectedControlRevision: latest.workspace?.controlRevision ?? 0,
            draft: draft.value,
          },
          key(),
        );
        if (action === "free") {
          generation.current += 1;
          subscription.current?.abort();
          setTask(null);
          setPreview("");
          install(next);
          setStatus("已切换为自由造句，可以直接作答。");
          return;
        }
      }
      generation.current += 1;
      subscription.current?.abort();
      setTask(null);
      setPreview("");
      activeSession.current = null;
      setSession(null);
      await load();
      setStatus(
        action === "pause" ? "练习已暂停，草稿已保存。" : "本次练习已结束，未完成项不会计入掌握。",
      );
    });
  const resume = (saved: PracticeSession) =>
    act(async () => {
      let next = api.workspace ? await api.workspace.get(saved.id) : saved;
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
      const current = activeSession.current;
      if (!current || draft.value.trim() === "") return;
      void draft.flush();
      const input = { answer: draft.value, expectedRevision: current.revision };
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
    startDialogue: (itemIds, idempotencyKey) =>
      run({ version: 2, kind: "dialogue-start", input: { itemIds } }, () =>
        api.startDialogue(itemIds, idempotencyKey),
      ),
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
    start,
    control,
    resume,
    submit,
    retry,
    rate,
    dialogueApi,
    cancelTask,
  };
}

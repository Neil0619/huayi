import { useCallback, useEffect, useRef, useState } from "react";
import {
  LearningTaskError,
  type DailyPracticeQueueResponse,
  type LearningTaskSnapshot,
  type PracticeSession,
  type PracticeWorkspaceControl,
} from "@huayi/cloud-contracts";
import type { PracticePageApi } from "./practice-page-api.js";
import { pauseOtherPractice } from "./pause-other-practice.js";

interface NavigationOptions {
  readonly api: PracticePageApi;
  readonly key: () => string;
  readonly session: PracticeSession | null;
  readonly current: { current: PracticeSession | null };
  readonly draft: {
    value: string;
    flush(): Promise<void>;
    snapshot(): { value: string; revision: number; dirty: boolean; conflict: boolean };
  };
  readonly hintPolicy: "shown" | "on-demand";
  readonly act: (operation: () => Promise<unknown>) => Promise<void>;
  readonly install: (session: PracticeSession) => void;
  readonly subscribe: (task: LearningTaskSnapshot) => Promise<PracticeSession>;
  readonly stopWatching: () => void;
  readonly showOverview: () => Promise<unknown>;
  readonly setQueue: (queue: DailyPracticeQueueResponse) => void;
  readonly setStatus: (status: string) => void;
}
interface StartAttempt {
  readonly itemId: string;
  readonly mode: "guided" | "free";
  readonly key: string;
  readonly hintPolicy: "shown" | "on-demand";
}
interface NextPractice {
  readonly state: "idle" | "loading" | "ready" | "error";
  readonly item: DailyPracticeQueueResponse["items"][number] | null;
}
function isRated(session: PracticeSession | null) {
  return (
    session?.status === "completed" && session.items.every((item) => item.rating !== undefined)
  );
}
function nextItem(queue: DailyPracticeQueueResponse, session: PracticeSession) {
  const completed = new Set(session.items.map((item) => item.itemId));
  return queue.items.find((entry) => !completed.has(entry.item.id)) ?? null;
}

/** Navigation keeps the saved result visible until the next session is acknowledged. */
export function usePracticeNavigation(options: NavigationOptions) {
  const { api, current, key, setQueue } = options;
  const pendingStart = useRef<StartAttempt | null>(null);
  const queueRead = useRef(0);
  const [nextPractice, setNextPractice] = useState<NextPractice>({ state: "idle", item: null });
  const refreshNext = useCallback(async () => {
    const session = current.current;
    if (!session || !isRated(session)) return;
    const ticket = ++queueRead.current;
    setNextPractice({ state: "loading", item: null });
    try {
      const queue = await api.dailyQueue();
      if (ticket !== queueRead.current || current.current?.id !== session.id) return;
      setQueue(queue);
      setNextPractice({ state: "ready", item: nextItem(queue, session) });
    } catch {
      if (ticket === queueRead.current && current.current?.id === session.id)
        setNextPractice({ state: "error", item: null });
    }
  }, [api, current, setQueue]);
  const ratedSessionId = isRated(options.session) ? options.session?.id : null;
  useEffect(() => {
    if (ratedSessionId) void refreshNext();
    else setNextPractice({ state: "idle", item: null });
    return () => {
      queueRead.current += 1;
    };
  }, [ratedSessionId, refreshNext]);

  const begin = async (itemId: string, mode: "guided" | "free" = "guided") => {
    let attempt = pendingStart.current;
    if (
      !attempt ||
      attempt.itemId !== itemId ||
      attempt.mode !== mode ||
      attempt.hintPolicy !== options.hintPolicy
    ) {
      await pauseOtherPractice(api.workspace, key);
      attempt = { itemId, mode, hintPolicy: options.hintPolicy, key: key() };
      pendingStart.current = attempt;
    }
    // An uncertain response retries this exact creation instead of creating another session.
    if (api.workspace) {
      const ready = await api.workspace.start(
        {
          itemId,
          mode,
          ...(api.teaching
            ? {
                teachingContract: "practice-teaching-v1",
                ...(mode === "guided" && attempt.hintPolicy === "on-demand"
                  ? { hintPolicy: "on-demand" }
                  : {}),
              }
            : {}),
        },
        attempt.key,
      );
      options.install(ready);
      pendingStart.current = null;
      if (mode === "free") {
        options.setStatus("自由造句：请在新场景中使用这条表达或句型。");
        return;
      }
      if (api.tasks) {
        const snapshot = await api.tasks.submit(
          { version: 2, kind: "sentence-start", sessionId: ready.id, input: { itemId } },
          key(),
        );
        void options.subscribe(snapshot).catch(() => undefined);
        return;
      }
    }
    const next = await api.startSentence(itemId, attempt.key);
    options.install(next);
    pendingStart.current = null;
    options.setStatus(
      next.pendingGeneration ? "题目尚未完成，可以重试或自由造句。" : "题目已生成，可以开始作答。",
    );
  };
  const change = async (
    session: PracticeSession,
    action: PracticeWorkspaceControl["action"],
    requireRated = false,
  ) => {
    if (!api.workspace) return session;
    const latest = await api.workspace.get(session.id);
    if (requireRated && !isRated(latest)) throw new LearningTaskError("revision_conflict");
    // The previous end may have succeeded even when its response was lost.
    if (action !== "free" && ["ended", "skipped"].includes(latest.workspace?.phase ?? ""))
      return latest;
    const draft = options.draft.snapshot();
    if (draft.conflict) throw new LearningTaskError("revision_conflict");
    return api.workspace.control(
      session.id,
      {
        action,
        expectedRevision: latest.revision,
        expectedControlRevision: latest.workspace?.controlRevision ?? 0,
        ...(draft.dirty ? { draft: draft.value, expectedDraftRevision: draft.revision } : {}),
      },
      key(),
    );
  };
  return {
    nextPractice,
    refreshNext,
    start: (itemId: string, mode: "guided" | "free" = "guided") =>
      options.act(() => begin(itemId, mode)),
    next: () =>
      options.act(async () => {
        const session = current.current;
        if (!session || !isRated(session)) return;
        const queue = await api.dailyQueue();
        setQueue(queue);
        const item = nextItem(queue, session);
        setNextPractice({ state: "ready", item });
        const itemId = pendingStart.current?.itemId ?? item?.item.id;
        if (!itemId) return;
        await change(session, "end", true);
        options.stopWatching();
        await begin(itemId);
      }),
    control: (action: PracticeWorkspaceControl["action"]) =>
      options.act(async () => {
        const session = current.current;
        if (!session) return;
        const next = await change(session, action);
        options.stopWatching();
        if (action === "free") {
          options.install(next);
          options.setStatus("已切换为自由造句，可以直接作答。");
          return;
        }
        pendingStart.current = null;
        await options.showOverview();
        options.setStatus(
          action === "pause"
            ? "练习已暂停，草稿已保存。"
            : isRated(session)
              ? "本次练习已完成，自评与作答已保存。"
              : "本次练习已结束，未完成项不会计入掌握。",
        );
      }),
  };
}

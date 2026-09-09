import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  LearningTaskCommand,
  PracticeSession,
  PracticeWorkspaceControl,
} from "@huayi/cloud-contracts";
import { learningApi } from "../services/api";
import { localStore } from "../services/storage";
import { listTasks, submitTask } from "../services/tasks";
import { mergePractice } from "../services/practice-state";
import { draftWasSaved, type SubmittedDraft } from "../services/practice-draft";
import { useAction, useResource } from "./hooks";
import { useTask } from "./task-view";
import { session } from "../services/session";

export function usePractice(initialId: string | undefined, initialTask: string | undefined) {
  const account = useSyncExternalStore(session.subscribe, session.getSnapshot).account;
  const [owner, setOwner] = useState(account?.id ?? null);
  const [id, setId] = useState(initialId ?? null);
  const [storedValue, setValue] = useState<PracticeSession | null>(null);
  const [taskId, setTaskId] = useState<string | null>(initialTask ?? null);
  const [storedAnswer, setAnswer] = useState("");
  const authorized = !!account && account.id === owner;
  const value = authorized ? storedValue : null;
  const answer = authorized ? storedAnswer : "";
  const answerTooLong = answer.length > 4000;
  const restored = useRef<string | null>(null);
  const action = useAction();
  const currentId = useRef(id);
  currentId.current = id;
  const pendingDraft = useRef<SubmittedDraft | null>(null);
  const pendingScope = useRef<string | null>(null);
  // Hide during reauthentication; reset another owner's mirrors without touching saved drafts.
  if (account && account.id !== owner) {
    setOwner(account.id);
    if (owner) {
      setId(null);
      setValue(null);
      setAnswer("");
      setTaskId(null);
      currentId.current = null;
      restored.current = null;
      pendingDraft.current = null;
      pendingScope.current = null;
    }
  }
  const install = (incoming: PracticeSession) => {
    if (!authorized || session.getSnapshot().account?.id !== owner) return;
    if (currentId.current && currentId.current !== incoming.id) return;
    currentId.current = incoming.id;
    setId(incoming.id);
    setValue((current) => mergePractice(current, incoming));
    const pending = pendingDraft.current;
    if (pending && draftWasSaved(pending, incoming)) {
      pendingDraft.current = null;
      localStore.remove(`practice-submitted:${incoming.id}`);
      setAnswer((current) => {
        if (current !== pending.text) return current;
        localStore.remove(`practice-draft:${incoming.id}`);
        return "";
      });
    }
  };
  const resource = useResource(
    async () => ({
      session: id ? await learningApi.practice(id) : null,
      items: await learningApi.items({ limit: 100 }),
      tasks: await listTasks(),
    }),
    [id],
  );
  useEffect(() => {
    const loaded = resource.data;
    if (!loaded) return;
    if (loaded.session) install(loaded.session);
    const active = loaded.tasks.find(
      (task) => task.subjectId === id && ["queued", "running", "cancelling"].includes(task.state),
    );
    if (active) setTaskId(active.id);
  }, [resource.data]);
  useEffect(() => {
    if (!value || restored.current === value.id) return;
    restored.current = value.id;
    const draft = localStore.get(`practice-draft:${value.id}`);
    const submitted = localStore.get(`practice-submitted:${value.id}`);
    if (
      typeof submitted === "object" &&
      submitted !== null &&
      "sessionId" in submitted &&
      submitted.sessionId === value.id &&
      "revision" in submitted &&
      typeof submitted.revision === "number" &&
      "text" in submitted &&
      typeof submitted.text === "string" &&
      "attemptCount" in submitted &&
      typeof submitted.attemptCount === "number" &&
      "turnCount" in submitted &&
      typeof submitted.turnCount === "number"
    )
      pendingDraft.current = {
        sessionId: value.id,
        revision: submitted.revision,
        text: submitted.text,
        attemptCount: submitted.attemptCount,
        turnCount: submitted.turnCount,
      };
    const pending = pendingDraft.current;
    const saved = pending && draftWasSaved(pending, value);
    const restoredAnswer = typeof draft === "string" ? draft : (value.workspace?.draft ?? "");
    const clearDraft = saved && restoredAnswer === pending.text;
    if (saved) {
      if (clearDraft) localStore.remove(`practice-draft:${value.id}`);
      localStore.remove(`practice-submitted:${value.id}`);
      pendingDraft.current = null;
    }
    setAnswer(clearDraft ? "" : restoredAnswer);
  }, [value]);
  const task = useTask(authorized ? taskId : null, (payload) => {
    if (payload.type === "practice.updated") install(payload.session);
  });
  useEffect(() => {
    if (
      authorized &&
      task.snapshot &&
      !["queued", "running", "cancelling"].includes(task.snapshot.state) &&
      pendingScope.current
    ) {
      localStore.remove(`write:task:${pendingScope.current}`);
      pendingScope.current = null;
    }
  }, [task.snapshot, authorized]);
  const changeAnswer = (text: string) => {
    if (!authorized || session.getSnapshot().account?.id !== owner) return;
    setAnswer(text);
    if (id) localStore.set(`practice-draft:${id}`, text);
  };
  const startTask = async (command: LearningTaskCommand, retry = false) => {
    if (!authorized || session.getSnapshot().account?.id !== owner) return;
    const scope = `practice:${id ?? "new"}:${command.kind}`;
    if (retry && task.snapshot && ["failed", "cancelled"].includes(task.snapshot.state))
      localStore.remove(`write:task:${scope}`);
    const snapshot = await submitTask(scope, command);
    if (session.getSnapshot().account?.id !== owner) return;
    pendingScope.current = scope;
    setTaskId(snapshot.id);
    if (snapshot.output?.type === "practice.updated") install(snapshot.output.session);
  };
  const generate = () =>
    action.run(async () => {
      if (!value) return;
      await startTask(
        {
          version: 2,
          kind: "sentence-start",
          sessionId: value.id,
          input: { itemId: value.items[0]?.itemId ?? "" },
        },
        true,
      );
    });
  const submit = () =>
    action.run(async () => {
      if (!value || answerTooLong) return;
      const pending = {
        sessionId: value.id,
        revision: value.revision,
        text: answer,
        attemptCount: value.attempts?.length ?? 0,
        turnCount: value.turns.length,
      };
      pendingDraft.current = pending;
      localStore.set(`practice-submitted:${value.id}`, pending);
      const command: LearningTaskCommand =
        value.type === "dialogue"
          ? {
              version: 2,
              kind: "dialogue-turn",
              sessionId: value.id,
              input: { content: answer, expectedRevision: value.revision },
            }
          : {
              version: 2,
              kind: "sentence-submit",
              sessionId: value.id,
              input: { answer, expectedRevision: value.revision },
            };
      await startTask(command);
    });
  const syncDraft = async () => {
    if (answerTooLong || !value?.workspace || value.workspace.phase !== "active") return;
    try {
      const next = await learningApi.draft(value.id, {
        draft: answer,
        expectedDraftRevision: value.workspace.draftRevision,
      });
      install(next);
    } catch {
      action.setError("本机草稿已保存，服务器草稿同步未完成。请刷新后核对。");
    }
  };
  const control = (command: PracticeWorkspaceControl["action"]) =>
    action.run(async () => {
      if (!value || (answerTooLong && command !== "resume")) return;
      install(
        await learningApi.control(value.id, {
          action: command,
          expectedRevision: value.revision,
          ...(value.workspace?.controlRevision === undefined
            ? {}
            : { expectedControlRevision: value.workspace.controlRevision }),
          ...(answerTooLong ? {} : { draft: answer }),
        }),
      );
    });
  const finish = () =>
    action.run(async () => {
      if (value)
        await startTask(
          {
            version: 2,
            kind: "dialogue-finish",
            sessionId: value.id,
            input: { expectedRevision: value.revision },
          },
          true,
        );
    });
  const retry = () =>
    action.run(async () => {
      if (!value) return;
      const last = value.attempts?.at(-1);
      if (value.type === "sentence-creation" && last)
        await startTask(
          {
            version: 2,
            kind: "sentence-feedback-retry",
            sessionId: value.id,
            attemptId: last.id,
            input: { expectedRevision: value.revision },
          },
          true,
        );
      else if (value.type === "dialogue")
        await startTask(
          {
            version: 2,
            kind: "dialogue-retry",
            sessionId: value.id,
            input: { expectedRevision: value.revision },
          },
          true,
        );
    });
  return {
    value,
    answer,
    answerTooLong,
    changeAnswer,
    action,
    resource,
    task,
    taskId: authorized ? taskId : null,
    generate,
    submit,
    syncDraft,
    control,
    finish,
    retry,
    install,
    startDialogue: (itemIds: string[]) =>
      action.run(() => startTask({ version: 2, kind: "dialogue-start", input: { itemIds } })),
  };
}

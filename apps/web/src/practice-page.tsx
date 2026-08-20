import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type {
  DailyPracticeQueueResponse,
  LearningItemDetailResponse,
  PracticeSession,
} from "@huayi/cloud-contracts";

import { DialoguePracticePanel } from "./dialogue-practice-panel.js";
import type { PracticePageApi } from "./practice-page-api.js";
import { PracticeShell } from "./practice-shell.js";

export type { PracticePageApi } from "./practice-page-api.js";

function primary(item: DailyPracticeQueueResponse["items"][number]) {
  return item.item.content.type === "expression"
    ? item.item.content.text
    : item.item.content.template;
}

function meaning(item: DailyPracticeQueueResponse["items"][number]) {
  return item.item.content.type === "expression"
    ? item.item.content.meaningZh
    : item.item.content.functionZh;
}

export function PracticePage({
  api,
  idempotencyKey = () => crypto.randomUUID(),
}: {
  readonly api: PracticePageApi;
  readonly idempotencyKey?: () => string;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<LearningItemDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<DailyPracticeQueueResponse | null>(null);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [status, setStatus] = useState("");
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  const loadGeneration = useRef(0);

  const load = useCallback(async (): Promise<PracticeSession | null> => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const response = await api.dailyQueue();
      if (generation !== loadGeneration.current) return null;
      setQueue(response);
      setSession(response.currentSession);
      if (response.currentSession !== null) {
        const recoveredAnswer = response.currentSession.attempts?.at(-1)?.answer;
        if (recoveredAnswer !== undefined) setAnswer(recoveredAnswer);
        if (
          response.currentSession.type === "sentence-creation" &&
          response.currentSession.status === "completed"
        ) {
          const itemId = response.currentSession.items[0]?.itemId;
          if (itemId !== undefined) {
            const nextDetail = await api.getLearningItem(itemId);
            if (generation !== loadGeneration.current) return null;
            setDetail(nextDetail);
          }
        }
      }
      return response.currentSession;
    } catch {
      if (generation !== loadGeneration.current) return null;
      setError("暂时无法载入今日练习，请检查网络后重试。");
      return null;
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (session?.status === "completed") feedbackHeading.current?.focus();
  }, [session?.status]);

  const revealCompleted = async (next: PracticeSession) => {
    setSession(next);
    if (next.status !== "completed") {
      setStatus("作答已保存，反馈尚未完成；请显式重试反馈。");
      return;
    }
    const itemId = next.items[0]?.itemId;
    if (itemId === undefined) throw new Error("Practice item missing.");
    setDetail(await api.getLearningItem(itemId));
    setStatus("反馈已完成；现在可以查看来源例句并进行自评。");
  };

  const start = async (itemId: string) => {
    setBusy(true);
    setError(null);
    try {
      setSession(await api.startSentence(itemId, idempotencyKey()));
      setAnswer("");
      setDetail(null);
      setStatus("练习题已生成。");
    } catch {
      setError("暂时无法开始练习；当前构建可能尚未接通练习模型。");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (session === null) return;
    setBusy(true);
    setError(null);
    try {
      await revealCompleted(
        await api.submitAttempt(
          session.id,
          { answer, expectedRevision: session.revision },
          idempotencyKey(),
        ),
      );
    } catch {
      setError("作答可能已保存，但反馈暂不可用；请保留当前页面并重试反馈。");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const retryFeedback = async () => {
    const attempt = session?.attempts?.at(-1);
    if (session === null || attempt === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await revealCompleted(
        await api.retryFeedback(
          session.id,
          attempt.id,
          { expectedRevision: session.revision },
          idempotencyKey(),
        ),
      );
    } catch {
      setError("反馈仍不可用；作答已保留，不会自动再次请求模型。");
    } finally {
      setBusy(false);
    }
  };

  const retryPrompt = async () => {
    const itemId = session?.items[0]?.itemId;
    if (session === null || itemId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.startSentence(itemId, idempotencyKey());
      setSession(next);
      setStatus(
        next.pendingGeneration === "sentence-prompt"
          ? "题目仍未完成；系统不会自动再次调用模型。"
          : "练习题已生成。",
      );
    } catch {
      setError("题目仍不可用；学习项已保留，不会自动再次请求模型。");
    } finally {
      setBusy(false);
    }
  };

  const rate = async (rating: "effortful" | "forgot" | "mastered") => {
    const itemId = session?.items[0]?.itemId;
    if (session === null || itemId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      setSession(
        await api.rate(
          session.id,
          { expectedRevision: session.revision, ratings: [{ itemId, rating }] },
          idempotencyKey(),
        ),
      );
      setStatus("自评已保存，排期已更新。");
    } catch {
      setError("暂时无法保存自评；排期没有在页面本地推进。");
    } finally {
      setBusy(false);
    }
  };

  const activeTarget =
    queue?.currentItems[0] ??
    queue?.items.find((item) => item.item.id === session?.items[0]?.itemId);
  const rated = session?.items[0]?.rating !== undefined;

  return (
    <PracticeShell>
      <header className="page-heading">
        <div>
          <p className="eyebrow">TODAY</p>
          <h1>今日练习</h1>
        </div>
        <p>先完成句子创作反馈，再用“不会／勉强／掌握”更新排期。</p>
      </header>
      <p className="practice-history-link">
        <a href="/practice/history">查看练习历史</a>
      </p>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      {loading && <p role="status">正在载入今日练习…</p>}
      {error !== null && (
        <div className="alert" role="alert">
          <p>{error}</p>
          {queue === null && !loading && (
            <button data-retry-practice onClick={() => void load()} type="button">
              重新载入
            </button>
          )}
        </div>
      )}
      {!loading && queue?.items.length === 0 && session === null && (
        <section className="empty-state">
          <h2>今天没有待练习内容</h2>
          <p>到期项会优先出现，再由新学习项补足每日目标。</p>
        </section>
      )}
      {!loading && queue !== null && queue.items.length > 0 && session === null && (
        <section className="practice-queue">
          <h2>
            今日目标 {queue.items.length}/{queue.dailyGoal}
          </h2>
          <p>账号时区：{queue.timezone}</p>
          <div>
            {queue.items.map((item) => (
              <article key={item.item.id}>
                <p className="eyebrow">{item.schedule.level === -1 ? "NEW" : "DUE"}</p>
                <h3>{primary(item)}</h3>
                <p>{meaning(item)}</p>
                <button
                  data-start-practice
                  disabled={busy}
                  onClick={() => void start(item.item.id)}
                  type="button"
                >
                  开始句子创作
                </button>
              </article>
            ))}
          </div>
          <DialoguePracticePanel
            api={api}
            idempotencyKey={idempotencyKey}
            onRecover={load}
            onSession={setSession}
            queue={queue}
            session={null}
          />
        </section>
      )}
      {session?.type === "dialogue" && queue !== null && (
        <DialoguePracticePanel
          api={api}
          idempotencyKey={idempotencyKey}
          onRecover={load}
          onSession={setSession}
          queue={queue}
          session={session}
        />
      )}
      {session?.type === "sentence-creation" && activeTarget !== undefined && (
        <section className="practice-session">
          <p className="eyebrow">SENTENCE CREATION</p>
          <h2>{primary(activeTarget)}</h2>
          <p>{meaning(activeTarget)}</p>
          {session.pendingGeneration === "sentence-prompt" ? (
            <div className="practice-prompt">
              <h3>题目尚未完成</h3>
              <p>学习项已保存；系统不会自动再次调用模型。</p>
              <button
                data-retry-prompt
                disabled={busy}
                onClick={() => void retryPrompt()}
                type="button"
              >
                重试生成题目
              </button>
            </div>
          ) : (
            <div className="practice-prompt">
              <h3>任务</h3>
              <p>{session.prompt}</p>
            </div>
          )}
          {session.status === "active" && (
            <form data-attempt-form onSubmit={(event) => void submit(event)}>
              <label>
                你的英文句子
                <textarea
                  maxLength={4000}
                  name="answer"
                  onChange={(event) => setAnswer(event.currentTarget.value)}
                  required
                  value={answer}
                />
              </label>
              <button disabled={busy} type="submit">
                {busy ? "正在保存…" : "提交并获取反馈"}
              </button>
            </form>
          )}
          {session.status === "awaiting-feedback" &&
            session.pendingGeneration !== "sentence-prompt" && (
              <div>
                <h3>反馈尚未完成</h3>
                <p>已保存的作答：</p>
                <blockquote>{session.attempts?.at(-1)?.answer}</blockquote>
                <p>作答已保存；系统不会自动再次调用模型。</p>
                <button
                  data-retry-feedback
                  disabled={busy}
                  onClick={() => void retryFeedback()}
                  type="button"
                >
                  重试反馈
                </button>
              </div>
            )}
          {session.status === "completed" && (
            <div className="practice-feedback">
              <h3 data-feedback-heading ref={feedbackHeading} tabIndex={-1}>
                练习反馈
              </h3>
              <p>{session.finalFeedback}</p>
              {detail !== null && (
                <div>
                  <h4>来源例句</h4>
                  {detail.item.sourceExamples.length === 0 ? (
                    <p>这条学习项没有来源例句。</p>
                  ) : (
                    detail.item.sourceExamples.map((source) => (
                      <blockquote key={source.id}>{source.sourceText}</blockquote>
                    ))
                  )}
                </div>
              )}
              {!rated && (
                <fieldset disabled={busy}>
                  <legend>这次掌握得怎么样？</legend>
                  <button data-rating="forgot" onClick={() => void rate("forgot")} type="button">
                    不会
                  </button>
                  <button
                    data-rating="effortful"
                    onClick={() => void rate("effortful")}
                    type="button"
                  >
                    勉强
                  </button>
                  <button
                    data-rating="mastered"
                    onClick={() => void rate("mastered")}
                    type="button"
                  >
                    掌握
                  </button>
                </fieldset>
              )}
              {rated && <p>自评已保存，排期已更新。</p>}
            </div>
          )}
        </section>
      )}
    </PracticeShell>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  DailyPracticeQueueResponse,
  LearningItemDetailResponse,
  PracticeSession,
} from "@huayi/cloud-contracts";

import type { PracticePageApi } from "./practice-page-api.js";

type Rating = "effortful" | "forgot" | "mastered";

function primary(item: DailyPracticeQueueResponse["items"][number]) {
  return item.item.content.type === "expression"
    ? item.item.content.text
    : item.item.content.template;
}

export function DialoguePracticePanel({
  api,
  idempotencyKey,
  onRecover,
  onSession,
  queue,
  session,
}: {
  readonly api: PracticePageApi;
  readonly idempotencyKey: () => string;
  readonly onRecover: () => Promise<PracticeSession | null>;
  readonly onSession: (session: PracticeSession) => void;
  readonly queue: DailyPracticeQueueResponse;
  readonly session: PracticeSession | null;
}) {
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<LearningItemDetailResponse[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  const requestGeneration = useRef(0);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (session?.type !== "dialogue" || session.status !== "completed") return;
    const generation = ++requestGeneration.current;
    void Promise.all(session.items.map((item) => api.getLearningItem(item.itemId))).then(
      (loaded) => {
        if (generation !== requestGeneration.current) return;
        setDetails(loaded);
        feedbackHeading.current?.focus();
      },
      () => {
        if (generation === requestGeneration.current) {
          setError("逐项反馈已完成，但来源例句暂时无法载入。");
        }
      },
    );
  }, [api, session]);
  const run = async (operation: () => Promise<PracticeSession>, success: string) => {
    const generation = ++requestGeneration.current;
    setBusy(true);
    setError(null);
    try {
      const next = await operation();
      if (generation !== requestGeneration.current) return false;
      onSession(next);
      setStatus(
        next.status === "awaiting-feedback" ? "请求仍在处理中；没有启动第二次模型调用。" : success,
      );
      return true;
    } catch {
      if (generation === requestGeneration.current) {
        setError("请求未完成；已提交的对话内容仍以服务器记录为准，请显式重试。");
        const recovered = await onRecover();
        const lastUserTurn = [...(recovered?.turns ?? [])]
          .reverse()
          .find((turn) => turn.role === "user");
        if (lastUserTurn?.content === draft.trim()) setDraft("");
      }
      return false;
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  };

  if (session === null) {
    return (
      <section className="dialogue-starter">
        <h2>受约束对话</h2>
        <p>选择 1–3 个今日学习项；对话进行 3–5 轮，结束后统一查看反馈。</p>
        <fieldset disabled={busy}>
          <legend>选择对话练习项</legend>
          {queue.items.map((item) => (
            <label key={item.item.id}>
              <input
                checked={selected.includes(item.item.id)}
                disabled={!selected.includes(item.item.id) && selected.length >= 3}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelected((current) =>
                    checked
                      ? [...current, item.item.id]
                      : current.filter((id) => id !== item.item.id),
                  );
                }}
                type="checkbox"
              />
              {primary(item)}
            </label>
          ))}
        </fieldset>
        <button
          data-start-dialogue
          disabled={busy || selected.length === 0}
          onClick={() =>
            void run(() => api.startDialogue(selected, idempotencyKey()), "对话情境与开场已生成。")
          }
          type="button"
        >
          {busy ? "正在生成…" : "开始对话"}
        </button>
        {error !== null && <p role="alert">{error}</p>}
      </section>
    );
  }
  if (session.type !== "dialogue") return null;

  const rounds = session.turns.filter((turn) => turn.role === "user").length;
  const waitingStart = session.pendingGeneration === "dialogue-start";
  const waitingAssistant = session.pendingGeneration === "assistant-turn";
  const waitingFinal = session.pendingGeneration === "final-feedback";
  const rated = session.items.every((item) => item.rating !== undefined);
  const currentItems = session.items.map((sessionItem) =>
    [...queue.currentItems, ...queue.items].find((item) => item.item.id === sessionItem.itemId),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim() === "") return;
    void run(
      () =>
        api.submitTurn(
          session.id,
          { content: draft, expectedRevision: session.revision },
          idempotencyKey(),
        ),
      "你的回复已保存；助手回复已更新。",
    ).then((completed) => {
      if (completed) setDraft("");
    });
  };

  return (
    <section className="dialogue-session">
      <p className="eyebrow">CONSTRAINED DIALOGUE · {rounds}/5 ROUNDS</p>
      <h2>受约束对话</h2>
      {session.dialoguePlan !== undefined && (
        <dl className="dialogue-plan">
          <div>
            <dt>角色</dt>
            <dd>{session.dialoguePlan.roleZh}</dd>
          </div>
          <div>
            <dt>任务</dt>
            <dd>{session.dialoguePlan.taskZh}</dd>
          </div>
          <div>
            <dt>结束条件</dt>
            <dd>{session.dialoguePlan.endConditionZh}</dd>
          </div>
        </dl>
      )}
      <ol aria-label="对话内容" className="dialogue-turns">
        {session.turns.map((turn) => (
          <li className={turn.role} key={turn.id}>
            <strong>{turn.role === "assistant" ? "情境角色" : "你"}</strong>
            <p>{turn.content}</p>
          </li>
        ))}
      </ol>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      {error !== null && <p role="alert">{error}</p>}
      {session.status === "active" && rounds < 5 && (
        <form data-dialogue-turn-form onSubmit={submit}>
          <label>
            你的英文回复
            <textarea
              maxLength={4000}
              name="dialogue-turn"
              onChange={(event) => setDraft(event.currentTarget.value)}
              required
              value={draft}
            />
          </label>
          <button disabled={busy} type="submit">
            {busy ? "正在保存…" : "发送回复"}
          </button>
        </form>
      )}
      {session.status === "active" && rounds >= 3 && (
        <button
          data-finish-dialogue
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                api.finish(session.id, { expectedRevision: session.revision }, idempotencyKey()),
              "对话最终反馈已生成。",
            )
          }
          type="button"
        >
          结束并获取反馈
        </button>
      )}
      {session.status === "awaiting-feedback" && (
        <div className="dialogue-pending">
          <h3>
            {waitingStart
              ? "对话情境尚未完成"
              : waitingAssistant
                ? "助手回复尚未完成"
                : "最终反馈尚未完成"}
          </h3>
          <p>
            {waitingStart ? "学习项选择已保存" : "你的回复已经保存"}
            ；系统不会自动发起第二次模型调用。
          </p>
          <button
            data-retry-dialogue
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  waitingStart
                    ? api.startDialogue(
                        session.items.map((item) => item.itemId),
                        idempotencyKey(),
                      )
                    : waitingAssistant
                      ? api.retryAssistant(
                          session.id,
                          { expectedRevision: session.revision },
                          idempotencyKey(),
                        )
                      : api.finish(
                          session.id,
                          { expectedRevision: session.revision },
                          idempotencyKey(),
                        ),
                waitingStart
                  ? "对话情境与开场已生成。"
                  : waitingAssistant
                    ? "助手回复已更新。"
                    : "最终反馈已生成。",
              )
            }
            type="button"
          >
            {waitingStart ? "重试生成对话情境" : waitingFinal ? "重试最终反馈" : "重试助手回复"}
          </button>
        </div>
      )}
      {session.status === "completed" && (
        <div className="dialogue-feedback">
          <h3 ref={feedbackHeading} tabIndex={-1}>
            对话反馈
          </h3>
          <p>{session.finalFeedback}</p>
          {session.itemFeedbacks?.map((feedback) => {
            const item = currentItems.find((candidate) => candidate?.item.id === feedback.itemId);
            const detail = details.find((candidate) => candidate.item.id === feedback.itemId);
            return (
              <article key={feedback.itemId}>
                <h4>{item === undefined ? "学习项" : primary(item)}</h4>
                <p>{feedback.feedback}</p>
                {detail !== undefined && (
                  <div>
                    <h5>来源例句</h5>
                    {detail.item.sourceExamples.length === 0 ? (
                      <p>这条学习项没有来源例句。</p>
                    ) : (
                      detail.item.sourceExamples.map((source) => (
                        <blockquote key={source.id}>{source.sourceText}</blockquote>
                      ))
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {!rated && (
            <form
              data-dialogue-ratings
              onSubmit={(event) => {
                event.preventDefault();
                if (Object.keys(ratings).length !== session.items.length) return;
                void run(
                  () =>
                    api.rate(
                      session.id,
                      {
                        expectedRevision: session.revision,
                        ratings: session.items.map((item) => ({
                          itemId: item.itemId,
                          rating: ratings[item.itemId] as Rating,
                        })),
                      },
                      idempotencyKey(),
                    ),
                  "所有学习项的自评与排期已原子更新。",
                );
              }}
            >
              <fieldset disabled={busy}>
                <legend>逐项自评</legend>
                {currentItems.map((item, index) => {
                  const itemId = session.items[index]?.itemId;
                  if (itemId === undefined) return null;
                  return (
                    <label key={itemId}>
                      {item === undefined ? "学习项" : primary(item)}
                      <select
                        onChange={(event) => {
                          const rating = event.currentTarget.value as Rating;
                          setRatings((current) => ({
                            ...current,
                            [itemId]: rating,
                          }));
                        }}
                        required
                        value={ratings[itemId] ?? ""}
                      >
                        <option disabled value="">
                          请选择
                        </option>
                        <option value="forgot">不会</option>
                        <option value="effortful">勉强</option>
                        <option value="mastered">掌握</option>
                      </select>
                    </label>
                  );
                })}
              </fieldset>
              <button disabled={busy || Object.keys(ratings).length !== session.items.length}>
                保存全部自评
              </button>
            </form>
          )}
          {rated && <p>所有自评已保存，排期已更新。</p>}
        </div>
      )}
    </section>
  );
}

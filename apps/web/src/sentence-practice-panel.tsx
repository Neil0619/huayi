import { useEffect, useRef } from "react";
import type { PracticePageApi } from "./practice-page-api.js";
import type { usePracticeWorkspace } from "./use-practice-workspace.js";
import { PracticeNextStep } from "./practice-next-step.js";
import { PracticeAttemptsReview, PracticeFeedback } from "./practice-teaching-feedback.js";
import { practiceItemTitle, practiceItemMeaning } from "./practice-item-list.js";

type State = ReturnType<typeof usePracticeWorkspace>;
export function SentencePracticePanel({
  state,
  api,
}: {
  readonly state: State;
  readonly api: PracticePageApi;
}) {
  const { session, busy, task, teaching } = state;
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  const answerField = useRef<HTMLTextAreaElement>(null);
  const data = teaching.data?.teaching;
  useEffect(() => {
    if (session?.status === "completed") feedbackHeading.current?.focus();
    else if (session?.status === "active" && (data?.round.ordinal ?? 0) > 0)
      answerField.current?.focus();
  }, [session?.status, data?.round.ordinal]);
  if (session?.type !== "sentence-creation") return null;
  const pending = session.pendingGeneration === "sentence-prompt";
  const generating = task !== null && ["queued", "running", "cancelling"].includes(task.state);
  const unknown = Boolean(api.teaching && !teaching.data);
  const onDemand = data?.hintPolicy === "on-demand" && session.workspace?.mode === "guided";
  const hideTarget =
    unknown || (onDemand && session.status !== "completed" && !data?.round.hintViewedAt);
  const target = [
    ...(state.queue?.items ?? []),
    ...(state.queue?.currentItems ?? []),
    ...(state.detail ? [state.detail] : []),
  ].find((item) => item.item.id === session.items[0]?.itemId);
  const content = data?.target.state === "available" ? data.target.content : null;
  const title =
    data?.target.state === "deleted"
      ? "学习项已删除"
      : content
        ? content.type === "expression"
          ? content.text
          : content.template
        : target
          ? practiceItemTitle(target)
          : "练习表达或句型";
  const meaning =
    data?.target.state === "deleted"
      ? ""
      : content
        ? content.type === "expression"
          ? content.meaningZh
          : content.functionZh
        : target
          ? practiceItemMeaning(target)
          : "";
  const rated = session.items.every((item) => item.rating !== undefined);
  const latest = session.attempts?.at(-1);
  const feedback = data?.attempts.find((item) => item.attemptId === latest?.id)?.feedback;
  const canRewrite = Boolean(
    data &&
    data.target.state === "available" &&
    session.workspace?.phase === "active" &&
    (session.attempts?.length ?? 0) < 5,
  );
  return (
    <section className="practice-session">
      <p>
        {session.workspace?.mode === "free" ? "自由造句" : onDemand ? "按需提示造句" : "引导造句"}
        {data && ` · 第 ${data.round.ordinal + 1} 次作答`}
      </p>
      <h2>{hideTarget ? "先看场景，写出你的表达" : title}</h2>
      {!hideTarget && meaning && <p>意思是{meaning}；请在一个新场景中使用它。</p>}
      {teaching.error && (
        <div className="alert" role="alert">
          <p>{teaching.error}</p>
          <button
            disabled={teaching.loading || busy}
            type="button"
            onClick={() => void teaching.refresh()}
          >
            重新读取练习详情
          </button>
        </div>
      )}
      {unknown && !teaching.error && <p role="status">正在读取练习信息…</p>}
      <div className="practice-prompt">
        <h3>{pending ? (generating ? "正在准备中文场景" : "题目尚未完成") : "你的任务"}</h3>
        <p>
          {pending
            ? "可以先写草稿，也可以直接切换为自由造句。"
            : unknown && session.status !== "completed"
              ? "读取完成后显示本次场景。"
              : session.prompt}
        </p>
        {pending && (
          <>
            <button
              data-retry-prompt
              disabled={busy || generating}
              onClick={() => void state.retry()}
              type="button"
            >
              重试生成题目
            </button>
            <button
              disabled={busy || !api.workspace}
              onClick={() => void state.control("free")}
              type="button"
            >
              改为自由造句
            </button>
          </>
        )}
        {onDemand && session.status === "active" && !pending && !data?.round.hintViewedAt && (
          <>
            <p>先试着自己表达，需要时再查看英文提示。</p>
            <button
              disabled={busy || generating || state.draft.conflict}
              type="button"
              onClick={() => void state.teachingAction("reveal-hint")}
            >
              查看英文提示
            </button>
          </>
        )}
        {data?.round.hintViewedAt && <p className="practice-hint-fact">本轮已记录查看提示。</p>}
      </div>
      {(session.status === "active" || pending) && (
        <form
          data-attempt-form
          onSubmit={(event) => {
            event.preventDefault();
            void state.submit();
          }}
        >
          <label>
            你的英文句子
            <textarea
              ref={answerField}
              maxLength={4000}
              name="answer"
              onChange={(event) => state.draft.setValue(event.currentTarget.value)}
              required
              value={state.draft.value}
            />
          </label>
          <p>
            {pending
              ? "草稿会保留。题目可用后提交，或改为自由造句。"
              : data && data.round.ordinal > 0
                ? "可以修改上一次作答，也可以换一句。提交后保存为新的作答。"
                : "提交后会生成反馈，再由你决定这次掌握得怎么样。"}
          </p>
          {state.draft.conflict && (
            <div role="group" aria-label="选择草稿版本">
              <button type="button" onClick={() => state.draft.resolveConflict("saved")}>
                使用已保存草稿
              </button>
              <button type="button" onClick={() => state.draft.resolveConflict("local")}>
                保留本地草稿并保存
              </button>
            </div>
          )}
          <button
            disabled={
              busy ||
              generating ||
              pending ||
              unknown ||
              state.draft.conflict ||
              state.draft.value.trim() === ""
            }
            type="submit"
          >
            提交并获取反馈
          </button>
        </form>
      )}
      {session.status === "awaiting-feedback" && !pending && (
        <section>
          <h3>{generating ? "正在生成反馈" : "反馈尚未完成"}</h3>
          <blockquote>{latest?.answer}</blockquote>
          <p>作答已保存，可以离开本页，稍后回来查看。</p>
          <button
            data-retry-feedback
            disabled={busy || generating}
            onClick={() => void state.retry()}
            type="button"
          >
            重试反馈
          </button>
        </section>
      )}
      {session.status === "completed" && (
        <div className="practice-feedback">
          <h3 data-feedback-heading ref={feedbackHeading} tabIndex={-1}>
            练习反馈
          </h3>
          {latest && (
            <>
              <h4>你的这次作答</h4>
              <blockquote lang="en">{latest.answer}</blockquote>
            </>
          )}
          <PracticeFeedback feedback={feedback} legacy={session.finalFeedback} />
          {data && (
            <div className="practice-rewrite-actions">
              {canRewrite ? (
                <button
                  type="button"
                  disabled={busy || state.draft.conflict}
                  onClick={() => void state.teachingAction("rewrite")}
                >
                  我再写一句
                </button>
              ) : (
                <p>
                  {data.target.state === "deleted"
                    ? "学习项已删除，可回看已保存的作答。"
                    : "本次作答已保留，可以回看或继续练习。"}
                </p>
              )}
              <p>原作答和反馈会保留。再写是可选的，提交后才会生成新的反馈。</p>
            </div>
          )}
          {state.detail && !unknown && data?.target.state !== "deleted" && (
            <details open={!data}>
              <summary>来源例句</summary>
              {state.detail.item.sourceExamples.length ? (
                state.detail.item.sourceExamples.map((source) => (
                  <blockquote key={source.id}>{source.sourceText}</blockquote>
                ))
              ) : (
                <p>这条学习项没有来源例句。</p>
              )}
            </details>
          )}
          {!rated && (
            <fieldset disabled={busy}>
              <legend>这次掌握得怎么样？</legend>
              {(
                [
                  ["forgot", "不会"],
                  ["effortful", "勉强"],
                  ["mastered", "掌握"],
                ] as const
              ).map(([rating, label]) => (
                <button
                  key={rating}
                  data-rating={rating}
                  type="button"
                  onClick={() => void state.rate(rating)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          )}
          {rated && <PracticeNextStep state={state} busy={busy} />}
        </div>
      )}
      {rated && data && <p>这次练习的自评已保存，改写不会再推进排期。</p>}
      {!hideTarget && Boolean(session.attempts?.length) && (
        <PracticeAttemptsReview session={session} teaching={data} />
      )}
    </section>
  );
}

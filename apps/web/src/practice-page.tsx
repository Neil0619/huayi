import { useEffect, useRef } from "react";
import type { DailyPracticeQueueResponse } from "@huayi/cloud-contracts";
import { PracticeOverview } from "./practice-overview.js";
import { DialoguePracticePanel } from "./dialogue-practice-panel.js";
import type { PracticePageApi } from "./practice-page-api.js";
import { usePracticeWorkspace } from "./use-practice-workspace.js";
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
const taskLabels = {
  queued: "已排队",
  running: "正在生成",
  cancelling: "正在停止",
  completed: "已完成",
  failed: "生成失败",
  cancelled: "已停止",
  unknown: "结果待核对",
};
export function PracticePage({
  api,
  idempotencyKey = () => crypto.randomUUID(),
}: {
  readonly api: PracticePageApi;
  readonly idempotencyKey?: () => string;
}) {
  const state = usePracticeWorkspace(api, idempotencyKey);
  const { queue, session, busy, loading, task } = state;
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (session?.status === "completed") feedbackHeading.current?.focus();
  }, [session?.status]);
  const target = [
    ...(queue?.items ?? []),
    ...(queue?.currentItems ?? []),
    ...(state.detail ? [state.detail] : []),
  ].find((item) => item.item.id === session?.items[0]?.itemId);
  const rated = session?.items.every((item) => item.rating !== undefined);
  const pending = session?.pendingGeneration === "sentence-prompt";
  const generating = task !== null && ["queued", "running", "cancelling"].includes(task.state);
  return (
    <>
      <header className="page-heading">
        <h1>今日练习</h1>
        <a className="button-link" href="/practice/history">
          练习历史
        </a>
      </header>
      <p aria-live="polite" role="status">
        {state.status}
      </p>
      {loading && <p role="status">正在载入今日练习…</p>}
      {state.error && (
        <div className="alert" role="alert">
          <p>{state.error}</p>
          {queue === null && (
            <button data-retry-practice onClick={() => void state.load()} type="button">
              重新载入
            </button>
          )}
        </div>
      )}
      {session === null && queue && (
        <PracticeOverview api={api} state={state} idempotencyKey={idempotencyKey} />
      )}
      {session !== null && (
        <nav aria-label="本次练习操作" className="practice-session-actions">
          <button onClick={() => void state.control("pause")} type="button">
            返回列表
          </button>
          <button onClick={() => void state.control("pause")} type="button">
            暂停练习
          </button>
          <button onClick={() => void state.control("skip")} type="button">
            跳过，换一项
          </button>
          <button onClick={() => void state.control("end")} type="button">
            结束本次练习
          </button>
        </nav>
      )}
      {task && (
        <section aria-label="生成进度" className="practice-generation">
          <p role="status">{taskLabels[task.state]}。可以保存草稿，或稍后回来继续。</p>
          {state.preview && (
            <p className="model-preview" aria-live="polite">
              {state.preview}
            </p>
          )}
          {generating && (
            <button
              disabled={task.state === "cancelling"}
              onClick={() => void state.cancelTask()}
              type="button"
            >
              {task.state === "cancelling" ? "等待停止确认…" : "停止生成"}
            </button>
          )}
        </section>
      )}
      {session?.type === "dialogue" && queue && (
        <DialoguePracticePanel
          api={state.dialogueApi}
          idempotencyKey={idempotencyKey}
          onRecover={state.load}
          onSession={state.install}
          queue={queue}
          session={session}
          draftControl={state.draft}
        />
      )}
      {session?.type === "sentence-creation" && (
        <section className="practice-session">
          <p>{session.workspace?.mode === "free" ? "自由造句" : "引导造句"}</p>
          <h2>{target ? primary(target) : "练习表达或句型"}</h2>
          {target && <p>意思是{meaning(target)}；请在一个新场景中使用它。</p>}
          <div className="practice-prompt">
            <h3>{pending ? (generating ? "正在准备中文场景" : "题目尚未完成") : "你的任务"}</h3>
            <p>{pending ? "可以先写草稿，也可以直接切换为自由造句。" : session.prompt}</p>
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
                  : "提交后会生成反馈，再由你决定这次掌握得怎么样。"}
              </p>
              <button
                disabled={busy || generating || pending || state.draft.value.trim() === ""}
                type="submit"
              >
                提交并获取反馈
              </button>
            </form>
          )}
          {session.status === "awaiting-feedback" && !pending && (
            <section>
              <h3>{generating ? "正在生成反馈" : "反馈尚未完成"}</h3>
              <blockquote>{session.attempts?.at(-1)?.answer}</blockquote>
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
              <p>{session.finalFeedback}</p>
              {state.detail && (
                <div>
                  <h4>来源例句</h4>
                  {state.detail.item.sourceExamples.length ? (
                    state.detail.item.sourceExamples.map((source) => (
                      <blockquote key={source.id}>{source.sourceText}</blockquote>
                    ))
                  ) : (
                    <p>这条学习项没有来源例句。</p>
                  )}
                </div>
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
                      onClick={() => void state.rate(rating)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </fieldset>
              )}
              {rated && (
                <>
                  <p>自评已保存，排期已更新。</p>
                  <button onClick={() => void state.control("end")} type="button">
                    下一项 · 返回总览
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}

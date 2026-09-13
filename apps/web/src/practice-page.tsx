import { useMemo } from "react";
import { SentencePracticePanel } from "./sentence-practice-panel.js";
import { PracticeNextStep } from "./practice-next-step.js";
import { PracticeOverview } from "./practice-overview.js";
import { DialoguePracticePanel } from "./dialogue-practice-panel.js";
import type { PracticePageApi } from "./practice-page-api.js";
import { usePracticeWorkspace } from "./use-practice-workspace.js";
export type { PracticePageApi } from "./practice-page-api.js";
const taskLabels = {
  queued: "已排队",
  running: "正在生成",
  cancelling: "正在停止",
  completed: "已完成",
  failed: "生成失败",
  cancelled: "已停止",
  unknown: "结果待核对",
};
function PracticePageContent({
  api,
  idempotencyKey = () => crypto.randomUUID(),
}: {
  readonly api: PracticePageApi;
  readonly idempotencyKey?: () => string;
}) {
  const state = usePracticeWorkspace(api, idempotencyKey);
  const { queue, session, busy, loading, task } = state;
  const rated = session?.items.every((item) => item.rating !== undefined);
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
          <button disabled={busy} onClick={() => void state.control("pause")} type="button">
            返回列表
          </button>
          <button disabled={busy} onClick={() => void state.control("pause")} type="button">
            暂停练习
          </button>
          <button disabled={busy} onClick={() => void state.control("skip")} type="button">
            跳过，换一项
          </button>
          <button disabled={busy} onClick={() => void state.control("end")} type="button">
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
      {session?.type === "dialogue" && session.status === "completed" && rated && (
        <PracticeNextStep state={state} busy={busy} />
      )}
      <SentencePracticePanel state={state} api={api} />
    </>
  );
}

export function PracticePage(props: Parameters<typeof PracticePageContent>[0]) {
  const scopeKey = useMemo(() => crypto.randomUUID(), [props.api]);
  return <PracticePageContent key={scopeKey} {...props} />;
}

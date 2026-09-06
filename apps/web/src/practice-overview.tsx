import { useState } from "react";
import { DialoguePracticePanel } from "./dialogue-practice-panel.js";
import { PracticeItemList } from "./practice-item-list.js";
import { PracticeResumeList } from "./practice-resume-list.js";
import type { PracticePageApi } from "./practice-page-api.js";
import type { usePracticeWorkspace } from "./use-practice-workspace.js";

export function PracticeOverview({
  api,
  state,
  idempotencyKey,
}: {
  readonly api: PracticePageApi;
  readonly state: ReturnType<typeof usePracticeWorkspace>;
  readonly idempotencyKey: () => string;
}) {
  const [mode, setMode] = useState("sentence");
  const { queue } = state;
  const busy =
    state.busy ||
    (state.task !== null && ["queued", "running", "cancelling"].includes(state.task.state));
  if (!queue) return null;
  return (
    <section className="practice-overview">
      <div className="practice-intro">
        <div>
          <h2>把读过的表达，用在自己的话里</h2>
          <p>先练一句，再试着用它完成一段对话。</p>
        </div>
        <div className="practice-daily-progress">
          <span>
            今日已练习 {queue.completedToday ?? 0} / {queue.dailyGoal} 项
          </span>
          <progress
            aria-label="今日练习进度"
            value={Math.min(queue.completedToday ?? 0, queue.dailyGoal)}
            max={queue.dailyGoal}
          />
        </div>
      </div>
      <div className="practice-overview-layout">
        <section className="practice-main-panel" aria-label="开始新练习">
          <div className="practice-mode-switch" role="group" aria-label="练习方式">
            <button
              aria-pressed={mode === "sentence"}
              onClick={() => setMode("sentence")}
              disabled={busy}
              type="button"
            >
              造句练习
            </button>
            <button
              aria-pressed={mode === "dialogue"}
              onClick={() => setMode("dialogue")}
              disabled={busy}
              type="button"
            >
              情境对话
            </button>
          </div>
          {queue.items.length === 0 ? (
            <section className="empty-state">
              <h3>今天没有待练习内容</h3>
              <p>从学习库选择表达或句型，或者先到收集箱整理原文。</p>
              <a href="/library">选择学习项</a> <a href="/app">打开收集箱</a>
            </section>
          ) : mode === "sentence" ? (
            <>
              <div className="practice-mode-intro">
                <h3>选择今天要用的表达或句型</h3>
                <p>引导造句：按中文场景写一句英文。自由造句：用自己的场景，立即开始。</p>
              </div>
              <PracticeItemList
                items={queue.items}
                busy={busy}
                freeAvailable={Boolean(api.workspace)}
                onStart={(id, choice) => void state.start(id, choice)}
              />
            </>
          ) : (
            <DialoguePracticePanel
              api={state.dialogueApi}
              idempotencyKey={idempotencyKey}
              onRecover={state.load}
              onSession={state.install}
              queue={queue}
              session={null}
            />
          )}
        </section>
        <PracticeResumeList
          api={api}
          queue={queue}
          sessions={state.resumable}
          busy={busy}
          onResume={(session) => void state.resume(session)}
        />
      </div>
    </section>
  );
}

import { useState } from "react";
import type { DailyPracticeQueueResponse } from "@huayi/cloud-contracts";
import { PracticeItemList, practiceItemTitle } from "./practice-item-list.js";
export function DialoguePracticeStarter({
  queue,
  busy,
  error,
  onStart,
}: {
  readonly queue: DailyPracticeQueueResponse;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onStart: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <section className="dialogue-starter">
      <div className="practice-mode-intro">
        <h3>把表达用进真实对话</h3>
        <p>选择 1–3 项，试着在和 AI 的英文对话中用出来。</p>
        <p>AI 会给你一个角色和任务。用英文回复 3–5 轮，结束后查看表达用法的反馈。</p>
      </div>
      <div className="dialogue-start-toolbar">
        <span aria-live="polite">已选 {selected.length} / 3 项</span>
        <button
          data-start-dialogue
          disabled={busy || selected.length === 0}
          onClick={() => onStart(selected)}
          type="button"
        >
          {busy ? "正在生成…" : "开始对话"}
        </button>
      </div>
      <div className="dialogue-selected-items" aria-label="已选对话学习项">
        {selected.map((id) => {
          const item = queue.items.find((entry) => entry.item.id === id);
          return (
            <button
              key={id}
              disabled={busy}
              onClick={() => setSelected((ids) => ids.filter((value) => value !== id))}
              type="button"
              aria-label={`移除 ${item ? practiceItemTitle(item) : "学习项"}`}
            >
              {item ? practiceItemTitle(item) : "学习项"} ×
            </button>
          );
        })}
      </div>
      <PracticeItemList
        items={queue.items}
        busy={busy}
        choice={{
          selected,
          onSelect: (id, checked) =>
            setSelected((ids) => (checked ? [...ids, id] : ids.filter((value) => value !== id))),
        }}
      />
      {error !== null && <p role="alert">{error}</p>}
    </section>
  );
}

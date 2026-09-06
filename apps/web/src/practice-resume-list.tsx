import { useEffect, useState } from "react";
import type { DailyPracticeQueueResponse, PracticeSession } from "@huayi/cloud-contracts";
import type { PracticePageApi } from "./practice-page-api.js";
import { practiceItemTitle } from "./practice-item-list.js";

function status(session: PracticeSession) {
  if (session.status === "completed") return "反馈已完成 · 待自评";
  if (
    session.pendingGeneration === "sentence-prompt" ||
    session.pendingGeneration === "dialogue-start"
  )
    return "场景待生成";
  if (session.pendingGeneration === "assistant-turn") return "等待对方回复";
  if (session.status === "awaiting-feedback") return "作答已保存 · 等待反馈";
  if (session.workspace?.draft.trim()) return "有草稿";
  return session.type === "dialogue"
    ? `已对话 ${session.turns.filter((turn) => turn.role === "user").length} 轮`
    : "尚未作答";
}
export function PracticeResumeList({
  api,
  queue,
  sessions,
  busy,
  onResume,
}: {
  readonly api: PracticePageApi;
  readonly queue: DailyPracticeQueueResponse;
  readonly sessions: PracticeSession[];
  readonly busy: boolean;
  readonly onResume: (session: PracticeSession) => void;
}) {
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);
  const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const visible = expanded ? sorted : sorted.slice(0, 3);
  const known = new Map(
    [...queue.items, ...queue.currentItems].map((item) => [item.item.id, practiceItemTitle(item)]),
  );
  const missing = [
    ...new Set(visible.flatMap((session) => session.items.map((item) => item.itemId))),
  ]
    .filter((id) => !known.has(id))
    .sort()
    .join(",");
  useEffect(() => {
    let live = true;
    void Promise.all(
      missing
        .split(",")
        .filter(Boolean)
        .map(async (id) => {
          const detail = await api.getLearningItem(id).catch(() => null);
          return [id, detail ? practiceItemTitle(detail) : "学习项暂不可用"] as const;
        }),
    ).then((entries) => {
      if (live) setTitles(Object.fromEntries(entries));
    });
    return () => {
      live = false;
    };
  }, [api, missing]);
  return (
    <aside className="practice-resume-panel" aria-labelledby="practice-resume-heading">
      <div className="practice-panel-heading">
        <h3 id="practice-resume-heading">继续练习</h3>
        <span>{sessions.length} 项未完成</span>
      </div>
      <p className="practice-resume-hint">这里保留未完成的练习；已完成的记录在练习历史中。</p>
      {visible.length === 0 ? (
        <p className="practice-no-matches">还没有未完成的练习。选择一项开始吧。</p>
      ) : (
        <div className="practice-resume-items">
          {visible.map((session, index) => {
            const title = session.items
              .map((item) => known.get(item.itemId) ?? titles[item.itemId] ?? "正在载入学习项…")
              .join(" / ");
            const draft = session.workspace?.draft.trim();
            const answer =
              session.attempts?.at(-1)?.answer ??
              session.turns.filter((turn) => turn.role === "user").at(-1)?.content;
            const mode =
              session.type === "dialogue"
                ? "情境对话"
                : session.workspace?.mode === "free"
                  ? "自由造句"
                  : "引导造句";
            const action =
              session.status === "completed"
                ? "查看反馈并自评"
                : index === 0
                  ? "继续上次练习"
                  : "继续这次练习";
            return (
              <article className="practice-resume-item" key={session.id}>
                <div className="practice-item-meta">
                  <span>{mode}</span>
                  <span>{status(session)}</span>
                </div>
                <h4>{title}</h4>
                <p className="practice-resume-excerpt">
                  {draft
                    ? `草稿：${draft}`
                    : answer
                      ? `已提交：${answer}`
                      : (session.dialoguePlan?.taskZh ??
                        session.prompt ??
                        "还没有作答，可以继续准备场景。")}
                </p>
                <div className="practice-resume-footer">
                  <time dateTime={session.updatedAt}>
                    {new Intl.DateTimeFormat("zh-CN", {
                      timeZone: queue.timezone,
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(session.updatedAt))}
                  </time>
                  <button
                    disabled={busy}
                    onClick={() => onResume(session)}
                    aria-label={`${action} · ${mode} · ${title}`}
                    type="button"
                  >
                    {action}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {sessions.length > 3 && (
        <button
          className="practice-show-saved"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {expanded ? "收起" : `查看全部 ${sessions.length} 项`}
        </button>
      )}
      <a href="/practice/history">查看已完成的练习历史</a>
    </aside>
  );
}

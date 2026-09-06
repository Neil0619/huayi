import { useState } from "react";
import type { DailyPracticeQueueResponse } from "@huayi/cloud-contracts";

export type PracticeItem = DailyPracticeQueueResponse["items"][number];
export function practiceItemTitle(item: PracticeItem) {
  return item.item.content.type === "expression"
    ? item.item.content.text
    : item.item.content.template;
}
export function practiceItemMeaning(item: PracticeItem) {
  return item.item.content.type === "expression"
    ? item.item.content.meaningZh
    : item.item.content.functionZh;
}
interface Choice {
  readonly selected: readonly string[];
  readonly onSelect: (id: string, checked: boolean) => void;
}
export function PracticeItemList({
  items,
  busy,
  choice,
  onStart,
  freeAvailable = false,
}: {
  readonly items: PracticeItem[];
  readonly busy: boolean;
  readonly choice?: Choice;
  readonly onStart?: (id: string, mode: "guided" | "free") => void;
  readonly freeAvailable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const matches = items.filter(
    (item) =>
      `${practiceItemTitle(item)} ${practiceItemMeaning(item)}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()) &&
      (filter === "all" ||
        (filter === "new" ? item.schedule.level === -1 : item.schedule.level !== -1)),
  );
  const pages = Math.max(1, Math.ceil(matches.length / 6));
  const current = Math.min(page, pages - 1);
  return (
    <div className="practice-item-browser">
      <div className="practice-list-toolbar">
        <label className="practice-search">
          查找学习项
          <input
            type="search"
            placeholder="搜索表达、句型或中文意思"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          练习范围
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.currentTarget.value);
              setPage(0);
            }}
          >
            <option value="all">全部（{items.length}）</option>
            <option value="review">到期复习</option>
            <option value="new">新学习项</option>
          </select>
        </label>
      </div>
      <div className="practice-items" aria-label={choice ? "选择对话练习项" : "今日学习项"}>
        {matches.slice(current * 6, (current + 1) * 6).map((item) => {
          const title = practiceItemTitle(item);
          const selected = choice?.selected.includes(item.item.id);
          const content = (
            <span className="practice-item-content">
              <span className="practice-item-meta">
                {item.item.content.type === "expression" ? "表达" : "句型"}
                <span>{item.schedule.level === -1 ? "新学习项" : "到期复习"}</span>
              </span>
              <strong>{title}</strong>
              <span className="practice-item-meaning">{practiceItemMeaning(item)}</span>
            </span>
          );
          return (
            <article
              className="practice-item-row"
              key={item.item.id}
              data-selected={selected || undefined}
            >
              {choice ? (
                <label className="practice-item-choice">
                  <input
                    type="checkbox"
                    aria-label={title}
                    checked={selected}
                    disabled={busy || (!selected && choice.selected.length >= 3)}
                    onChange={(event) => choice.onSelect(item.item.id, event.currentTarget.checked)}
                  />
                  {content}
                </label>
              ) : (
                <>
                  {content}
                  <div className="practice-item-actions">
                    <button
                      className="practice-primary"
                      data-start-practice
                      disabled={busy}
                      onClick={() => onStart?.(item.item.id, "guided")}
                      type="button"
                    >
                      引导造句
                    </button>
                    <button
                      disabled={busy || !freeAvailable}
                      onClick={() => onStart?.(item.item.id, "free")}
                      type="button"
                    >
                      自由造句
                    </button>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
      {matches.length === 0 && (
        <p className="practice-no-matches" role="status">
          没有匹配的学习项，试试其他关键词或练习范围。
        </p>
      )}
      <div className="practice-list-footer">
        <a href="/library">从学习库选择其他内容</a>
        {pages > 1 && (
          <nav aria-label="学习项分页">
            <button disabled={current === 0} onClick={() => setPage(current - 1)} type="button">
              上一页
            </button>
            <span role="status">
              {current + 1} / {pages} 页 · {matches.length} 项
            </span>
            <button
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
              type="button"
            >
              下一页
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}

import { useId } from "react";
import type { usePracticeReference } from "./use-practice-reference.js";

export function PracticeReferenceCard({
  reference,
  disabled,
}: {
  reference: ReturnType<typeof usePracticeReference>;
  disabled: boolean;
}) {
  const id = useId();
  if (!reference.available) return null;
  const unavailable = reference.detail && reference.detail.availability !== "available";
  const result = reference.detail?.reference;
  return (
    <aside className="practice-reference" aria-label="参考表达">
      <div className="practice-reference-entry">
        <div>
          <h3>没思路？先看一个参考</h3>
          <p>
            {unavailable
              ? "这道题暂时无法提供参考表达，仍可继续写自己的句子。"
              : reference.detail?.ready
                ? "参考已保存，可以反复查看。"
                : "按当前题目生成一个例句，首次生成将使用平台额度。"}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={reference.expanded}
          aria-controls={id}
          disabled={disabled || reference.loading || Boolean(unavailable)}
          onClick={() => void reference.toggle()}
        >
          {reference.loading
            ? "正在准备参考表达…"
            : reference.expanded
              ? "收起参考表达"
              : reference.error
                ? "重试查看参考表达"
                : "查看参考表达"}
        </button>
      </div>
      {reference.loading && <p role="status">可以继续写草稿，参考准备好后会在这里展开。</p>}
      {reference.error && <p role="alert">{reference.error}</p>}
      <div id={id} hidden={!reference.expanded}>
        {reference.expanded && result && (
          <div className="practice-reference-content">
            <p className="practice-reference-label">一个参考表达</p>
            <blockquote lang="en">{result.sentence}</blockquote>
            <p>{result.translationZh}</p>
            <p className="practice-reference-note">{result.usageNoteZh}</p>
            <p>表达方式不止一种。读一读，再试着换成自己的内容。</p>
          </div>
        )}
      </div>
    </aside>
  );
}

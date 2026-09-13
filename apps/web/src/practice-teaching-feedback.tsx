import { useState } from "react";
import type {
  PracticeSession,
  PracticeTeachingDetail,
  PracticeTeachingFeedback,
} from "@huayi/cloud-contracts";

export function PracticeFeedback({
  feedback,
  legacy,
}: {
  readonly feedback?: PracticeTeachingFeedback | null | undefined;
  readonly legacy?: string | undefined;
}) {
  if (!feedback) return <p className="practice-feedback-text">{legacy ?? "反馈尚未完成"}</p>;
  return (
    <div className="practice-teaching-feedback" data-feedback-assessment={feedback.assessment}>
      <section className="practice-feedback-main">
        <h4>{feedback.assessment === "ready" ? "这次表达已经清楚" : "这次先调整一处"}</h4>
        {feedback.assessment === "needs-revision" && (
          <blockquote>{feedback.answerExcerpt}</blockquote>
        )}
        <p>{feedback.mainPointZh}</p>
      </section>
      <section>
        <h4>参考表达</h4>
        <p lang="en">{feedback.exampleSentence}</p>
      </section>
      <section>
        <h4>怎么使用</h4>
        <p>{feedback.usageNoteZh}</p>
      </section>
    </div>
  );
}

export function PracticeAttemptsReview({
  session,
  teaching,
  expanded = false,
}: {
  readonly session: PracticeSession;
  readonly teaching?: PracticeTeachingDetail["teaching"] | undefined;
  readonly expanded?: boolean;
}) {
  const [open, setOpen] = useState(expanded);
  const attempts = session.attempts ?? [];
  if (!attempts.length) return <p>尚未提交作答。</p>;
  return (
    <section className="practice-attempt-review">
      {!expanded && (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "收起前后作答" : `回看前后作答（${attempts.length} 次）`}
        </button>
      )}
      {(expanded || open) && (
        <ol>
          {attempts.map((attempt, index) => {
            const metadata = teaching?.attempts.find((entry) => entry.attemptId === attempt.id);
            return (
              <li key={attempt.id}>
                <h4>{index === 0 ? "原作答" : `第 ${index} 次改写`}</h4>
                <blockquote lang="en">{attempt.answer}</blockquote>
                <PracticeFeedback feedback={metadata?.feedback} legacy={attempt.feedback} />
                <p className="practice-hint-fact">
                  {metadata
                    ? metadata.hintViewedAt
                      ? "本次已记录查看提示"
                      : "本次未记录查看提示"
                    : "旧记录未保存提示查看信息"}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

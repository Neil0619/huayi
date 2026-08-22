import type { PracticeHistoryDetailResponse, PracticeHistorySummary } from "@huayi/cloud-contracts";

const statusText = {
  active: "进行中",
  "awaiting-feedback": "等待生成或反馈",
  completed: "已完成",
  failed: "未完成",
};
const ratingText = { effortful: "勉强", forgot: "不会", mastered: "掌握" };

function itemLabel(
  item: PracticeHistorySummary["items"][number],
  labels: ReadonlyMap<string, string>,
) {
  if (item.learningItemDeletedAt !== undefined) return "学习项已删除";
  return labels.get(item.itemId) ?? "学习项";
}

export function PracticeHistoryDetail({
  detail,
}: {
  readonly detail: PracticeHistoryDetailResponse;
}) {
  const { session } = detail;
  const itemLabels = new Map(detail.itemLabels.map((item) => [item.itemId, item.label]));
  return (
    <>
      <p>
        状态：{statusText[session.status]} ·{" "}
        {detail.completedAt === null
          ? "尚未完成"
          : `完成于 ${new Date(detail.completedAt).toLocaleString("zh-CN")}`}
      </p>
      {session.prompt !== undefined && (
        <section>
          <h3>任务</h3>
          <p>{session.prompt}</p>
        </section>
      )}
      {session.type === "sentence-creation" && (
        <section>
          <h3>句子作答与反馈</h3>
          {session.attempts?.map((attempt) => (
            <article key={attempt.id}>
              <p>你的句子</p>
              <blockquote>{attempt.answer}</blockquote>
              <p>{attempt.feedback === undefined ? "反馈尚未完成" : attempt.feedback}</p>
            </article>
          )) ?? <p>尚未提交作答。</p>}
          {session.finalFeedback !== undefined && <p>最终反馈：{session.finalFeedback}</p>}
        </section>
      )}
      {session.type === "dialogue" && (
        <>
          {session.dialoguePlan !== undefined && (
            <dl className="practice-history-plan">
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
          <section>
            <h3>对话</h3>
            {session.turns.length === 0 ? (
              <p>对话开场尚未生成。</p>
            ) : (
              <ol className="practice-history-turns">
                {session.turns.map((turn) => (
                  <li className={turn.role} key={turn.id}>
                    <strong>{turn.role === "assistant" ? "情境助手" : "你"}</strong>
                    <p>{turn.content}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {session.itemFeedbacks !== undefined && (
            <section>
              <h3>逐项反馈</h3>
              {session.itemFeedbacks.map((feedback) => (
                <article key={feedback.itemId}>
                  <strong>
                    {itemLabel(
                      session.items.find(({ itemId }) => itemId === feedback.itemId) ?? {
                        itemId: feedback.itemId,
                      },
                      itemLabels,
                    )}
                  </strong>
                  <p>{feedback.feedback}</p>
                </article>
              ))}
            </section>
          )}
          {session.finalFeedback !== undefined && <p>总反馈：{session.finalFeedback}</p>}
        </>
      )}
      <section>
        <h3>用户自评</h3>
        <ul>
          {session.items.map((item) => (
            <li key={item.itemId}>
              {itemLabel(item, itemLabels)}：
              {item.rating === undefined ? "尚未自评" : ratingText[item.rating]}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

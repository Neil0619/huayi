import type { PracticeHistoryDetailResponse } from "@huayi/cloud-contracts";
import { Card, Paragraph } from "./ui";
const labels = { forgot: "不会", effortful: "勉强", mastered: "掌握" };
export function PracticeHistoryDetail({ detail }: { detail: PracticeHistoryDetailResponse }) {
  return (
    <>
      <Card title={detail.session.type === "dialogue" ? "情境对话" : "造句练习"}>
        <Paragraph>{detail.itemLabels.map((item) => item.label).join(" · ")}</Paragraph>
        <Paragraph>{detail.session.prompt}</Paragraph>
        {detail.session.dialoguePlan && (
          <>
            <Paragraph>角色：{detail.session.dialoguePlan.roleZh}</Paragraph>
            <Paragraph>目标：{detail.session.dialoguePlan.taskZh}</Paragraph>
          </>
        )}
      </Card>
      {detail.session.turns.map((turn) => (
        <Card key={turn.id} title={turn.role === "user" ? "我" : "对话伙伴"}>
          <Paragraph>{turn.content}</Paragraph>
        </Card>
      ))}
      {detail.session.attempts?.map((attempt) => (
        <Card key={attempt.id} title="作答与反馈">
          <Paragraph>{attempt.answer}</Paragraph>
          <Paragraph>{attempt.feedback}</Paragraph>
        </Card>
      ))}
      {detail.session.finalFeedback && (
        <Card title="本次反馈">
          <Paragraph>{detail.session.finalFeedback}</Paragraph>
        </Card>
      )}
      <Card title="自评与排期">
        {detail.session.items.map((item) => (
          <Paragraph key={item.itemId}>
            {detail.itemLabels.find((label) => label.itemId === item.itemId)?.label ??
              "已删除的学习项目"}{" "}
            · {item.rating ? labels[item.rating] : "尚未自评"}
            {item.scheduleAfter?.dueAt
              ? ` · 下次复习 ${new Date(item.scheduleAfter.dueAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}`
              : ""}
          </Paragraph>
        ))}
      </Card>
    </>
  );
}

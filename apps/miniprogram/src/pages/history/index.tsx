import { useState } from "react";
import { useRouter } from "@tarojs/taro";
import { Text } from "@tarojs/components";
import { useResource } from "../../components/hooks";
import { Action, Card, Empty, Notice, Screen, navigate } from "../../components/ui";
import { PracticeHistoryDetail } from "../../components/practice-history-detail";
import { learningApi } from "../../services/api";
const statuses = {
  active: "进行中",
  "awaiting-feedback": "等待反馈",
  completed: "已完成",
  failed: "可重试",
};
export default function History() {
  const { id } = useRouter().params;
  const [cursor, setCursor] = useState<string | undefined>();
  const resource = useResource(
    async () =>
      id
        ? { kind: "detail" as const, value: await learningApi.historyDetail(id) }
        : { kind: "list" as const, value: await learningApi.history({ limit: 20, cursor }) },
    [id, cursor],
  );
  const data = resource.data;
  return (
    <Screen title="练习记录" subtitle="每一次尝试都留下了进步的痕迹。">
      <Notice text={resource.error} />
      {data?.kind === "detail" && (
        <>
          <PracticeHistoryDetail detail={data.value} />
          {(data.value.session.status !== "completed" ||
            data.value.session.items.some((item) => !item.rating)) && (
            <Action onClick={() => void navigate("practice", { id: data.value.session.id })}>
              继续练习或自评
            </Action>
          )}
        </>
      )}
      {data?.kind === "list" && (
        <>
          {data.value.items.map((item) => (
            <Card key={item.id} title={item.type === "dialogue" ? "情境对话" : "造句练习"}>
              <Text className="pill">{statuses[item.status]}</Text>
              <Text className="muted">
                {new Date(item.createdAt).toLocaleDateString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}
              </Text>
              <Action secondary onClick={() => void navigate("history", { id: item.id })}>
                查看作答与反馈
              </Action>
            </Card>
          ))}
          {!data.value.items.length && (
            <Empty text="还没有练习记录。完成一次造句，来这里回看反馈。" />
          )}
          {data.value.nextCursor && (
            <Action secondary onClick={() => setCursor(data.value.nextCursor ?? undefined)}>
              下一页
            </Action>
          )}
        </>
      )}
      {resource.loading && <Empty text="正在读取练习记录…" />}
      {!id && cursor && (
        <Action secondary onClick={() => setCursor(undefined)}>
          回到第一页
        </Action>
      )}
      <Action secondary onClick={() => void resource.reload()}>
        刷新
      </Action>
    </Screen>
  );
}

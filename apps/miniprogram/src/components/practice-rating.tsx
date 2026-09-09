import { useState } from "react";
import { Text, View } from "@tarojs/components";
import type { PracticeSession } from "@huayi/cloud-contracts";
import { learningApi } from "../services/api";
import { Action, Card, Notice, Paragraph } from "./ui";
import { useAction } from "./hooks";
type Rating = "forgot" | "effortful" | "mastered";
const labels: Record<Rating, string> = { forgot: "不会", effortful: "勉强", mastered: "掌握" };
export function PracticeRating({
  value,
  itemLabels,
  onUpdate,
}: {
  value: PracticeSession;
  itemLabels: Record<string, string>;
  onUpdate(value: PracticeSession): void;
}) {
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const action = useAction();
  if (value.status !== "completed") return null;
  const pending = value.items.filter((item) => item.rating === undefined);
  return (
    <Card title={pending.length ? "这次掌握得怎么样？" : "自评已保存"}>
      <Notice text={action.error} />
      {value.items.map((item) => (
        <View key={item.itemId}>
          <Paragraph>{itemLabels[item.itemId] ?? "学习项目"}</Paragraph>
          {item.rating ? (
            <>
              <Text className="pill">{labels[item.rating]}</Text>
              <Paragraph>
                {item.scheduleAfter?.dueAt
                  ? `下次复习：${new Date(item.scheduleAfter.dueAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                  : "排期已更新"}
              </Paragraph>
            </>
          ) : (
            <View className="row">
              {Object.entries(labels).map(([key, label]) => (
                <Action
                  key={key}
                  secondary={ratings[item.itemId] !== key}
                  disabled={action.busy}
                  onClick={() =>
                    setRatings((values) => ({ ...values, [item.itemId]: key as Rating }))
                  }
                >
                  {label}
                </Action>
              ))}
            </View>
          )}
        </View>
      ))}
      {!!pending.length && (
        <Action
          disabled={action.busy || pending.some((item) => !ratings[item.itemId])}
          onClick={() =>
            void action.run(async () => {
              const submitted = pending.map((item) => ({
                itemId: item.itemId,
                rating: ratings[item.itemId] ?? "forgot",
              }));
              onUpdate(
                await learningApi.rate(value.id, {
                  expectedRevision: value.revision,
                  ratings: submitted,
                }),
              );
            })
          }
        >
          保存自评与复习排期
        </Action>
      )}
    </Card>
  );
}

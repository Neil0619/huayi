import { Text, View } from "@tarojs/components";
import { useAction, useResource } from "../../components/hooks";
import {
  Action,
  Card,
  Empty,
  Notice,
  Paragraph,
  Screen,
  contentLabel,
  contentMeaning,
  navigate,
} from "../../components/ui";
import { learningApi } from "../../services/api";

export default function Today() {
  const { data, error, loading, reload } = useResource(learningApi.daily);
  const action = useAction();
  const start = (itemId: string, mode: "free" | "guided") =>
    action.run(async () => {
      const session = await learningApi.startPractice({ itemId, mode });
      await navigate("practice", { id: session.id });
    });
  return (
    <Screen title="今日练习" subtitle="从一个表达开始，慢慢变成自己的语言。">
      <Notice text={error || action.error} />
      {data && (
        <>
          <Card>
            <Text className="muted">{data.date} · 北京时间</Text>
            <Text className="metric">
              {data.completedToday ?? 0} / {data.dailyGoal}
            </Text>
            <Paragraph>今天已经完成的学习项目</Paragraph>
          </Card>
          {data.currentSession && (
            <Card title="继续未完成练习">
              <Paragraph>
                {data.currentItems.map((item) => contentLabel(item.item.content)).join(" · ")}
              </Paragraph>
              <Action
                onClick={() => void navigate("practice", { id: data.currentSession?.id ?? "" })}
              >
                继续练习
              </Action>
            </Card>
          )}
          <View className="row">
            <Text className="card-title">待练项目</Text>
            <Text className="muted">{data.items.length} 项</Text>
          </View>
          {data.items.map(({ item, schedule }) => (
            <Card key={item.id} title={contentLabel(item.content)}>
              <Paragraph>{contentMeaning(item.content)}</Paragraph>
              <Text className="pill">{schedule.dueAt ? "到期复习" : "首次学习"}</Text>
              <View className="row">
                <Action disabled={action.busy} onClick={() => void start(item.id, "guided")}>
                  引导造句
                </Action>
                <Action
                  secondary
                  disabled={action.busy}
                  onClick={() => void start(item.id, "free")}
                >
                  自由造句
                </Action>
              </View>
              <Action secondary onClick={() => void navigate("practice", { items: item.id })}>
                情境对话
              </Action>
            </Card>
          ))}
          {!data.items.length && (
            <Empty text="今日队列已完成，或还没有学习项目。可以先收集一段英文，收藏想练的表达。" />
          )}
        </>
      )}
      {loading && <Empty text="正在读取今日进度…" />}
      <Action secondary onClick={() => void reload()}>
        刷新进度
      </Action>
      <Action secondary onClick={() => void navigate("history")}>
        练习历史
      </Action>
    </Screen>
  );
}

import { useState } from "react";
import { Input, Text, View } from "@tarojs/components";
import { useResource } from "../../components/hooks";
import { Action, Card, Empty, Notice, Paragraph, Screen, navigate } from "../../components/ui";
import { learningApi } from "../../services/api";
type Filter = "pending" | "analyzing" | "pendingReview" | "reviewed";
const filters: Record<Filter, string> = {
  pending: "待分析",
  analyzing: "分析中",
  pendingReview: "待整理",
  reviewed: "已整理",
};
export default function Inbox() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const resource = useResource(async () => {
    if (filter === "pending" || filter === "analyzing") {
      const result = await learningApi.captures({
        status: filter,
        query: search || undefined,
        cursor,
      });
      return {
        nextCursor: result.nextCursor,
        items: result.items.map((item) => ({
          id: item.capture.id,
          title: item.capture.title ?? item.capture.sourceText,
          text: item.capture.sourceText,
          date: item.capture.updatedAt,
          kind: "capture",
        })),
      };
    }
    const result = await learningApi.analyses({
      reviewState: filter,
      query: search || undefined,
      cursor,
    });
    return {
      nextCursor: result.nextCursor,
      items: result.items.map((item) => ({
        id: item.id,
        title: item.source.title ?? item.sourceText,
        text: item.sourceText,
        date: item.createdAt,
        kind: "analysis",
      })),
    };
  }, [filter, search, cursor]);
  return (
    <Screen title="收集箱" subtitle="从遇见的一句话，开始一次学习。">
      <Action onClick={() => void navigate("collect")}>＋ 粘贴原文</Action>
      <View className="row">
        {Object.entries(filters).map(([key, label]) => (
          <Action
            key={key}
            secondary={filter !== key}
            onClick={() => {
              setFilter(key as Filter);
              setCursor(undefined);
            }}
          >
            {label}
          </Action>
        ))}
      </View>
      <Input
        className="input"
        placeholder="搜索原文或标题"
        value={query}
        onInput={(event) => setQuery(event.detail.value)}
        onConfirm={() => {
          setSearch(query.trim());
          setCursor(undefined);
        }}
      />
      <Action
        secondary
        onClick={() => {
          setSearch(query.trim());
          setCursor(undefined);
        }}
      >
        搜索
      </Action>
      <Notice text={resource.error} />
      {resource.data?.items.map((item) => (
        <Card key={item.id} title={item.title.slice(0, 80)}>
          <Paragraph>{item.text.slice(0, 180)}</Paragraph>
          <Text className="muted">{item.date.slice(0, 10)}</Text>
          <Action
            secondary
            onClick={() =>
              void navigate("analysis", { [item.kind === "capture" ? "captureId" : "id"]: item.id })
            }
          >
            {item.kind === "capture" ? "查看原文与分析" : "阅读与整理"}
          </Action>
        </Card>
      ))}
      {!resource.loading && !resource.data?.items.length && (
        <Empty text="这里暂时没有内容。先粘贴一段想读懂的英文。" />
      )}
      {resource.loading && <Empty text="正在读取收集箱…" />}
      {resource.data?.nextCursor && (
        <Action secondary onClick={() => setCursor(resource.data?.nextCursor ?? undefined)}>
          下一页
        </Action>
      )}
      {cursor && (
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

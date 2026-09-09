import { useState } from "react";
import { Input, Picker, Text, View } from "@tarojs/components";
import { useResource } from "../../components/hooks";
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

export default function Library() {
  const [type, setType] = useState<"expression" | "sentence-pattern" | "word">("expression");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [tag, setTag] = useState("");
  const [archived, setArchived] = useState(false);
  const [due, setDue] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>();
  const resource = useResource(async () => {
    if (type === "word") {
      const result = await learningApi.words({ query: search || undefined, archived, cursor });
      return {
        nextCursor: result.nextCursor,
        items: result.items.map(({ word }) => ({
          id: word.id,
          title: word.headword,
          meaning: word.notes ?? "查看原文与释义",
          tags: [] as string[],
        })),
      };
    }
    const result = await learningApi.items({
      type,
      query: search || undefined,
      tag: tag.trim() || undefined,
      archived,
      due: due === 1 ? "due" : due === 2 ? "new" : undefined,
      cursor,
    });
    return {
      nextCursor: result.nextCursor,
      items: result.items.map((detail) => ({
        id: detail.item.id,
        title: contentLabel(detail.item.content),
        meaning: contentMeaning(detail.item.content),
        tags: detail.item.tags,
      })),
    };
  }, [type, search, tag, archived, due, cursor]);
  return (
    <Screen title="学习库" subtitle="值得留下的语言，随时回来练习。">
      <View className="row">
        {(
          [
            ["expression", "表达"],
            ["sentence-pattern", "句型"],
            ["word", "生词"],
          ] as const
        ).map(([key, label]) => (
          <Action
            key={key}
            secondary={type !== key}
            onClick={() => {
              setType(key);
              setCursor(undefined);
            }}
          >
            {label}
          </Action>
        ))}
      </View>
      <Input
        className="input"
        value={query}
        placeholder="搜索学习内容"
        onInput={(event) => setQuery(event.detail.value)}
        onConfirm={() => {
          setSearch(query.trim());
          setCursor(undefined);
        }}
      />
      <View className="row">
        <Action
          secondary
          onClick={() => {
            setSearch(query.trim());
            setCursor(undefined);
          }}
        >
          搜索
        </Action>
        <Action onClick={() => void navigate("item", { type })}>＋ 手动添加</Action>
      </View>
      {type === "word" && (
        <Action
          secondary
          onClick={() => {
            setArchived(!archived);
            setCursor(undefined);
          }}
        >
          {archived ? "查看使用中" : "查看已归档"}
        </Action>
      )}
      {type !== "word" && (
        <>
          <View className="row">
            <Picker
              range={["全部进度", "到期复习", "尚未练习"]}
              value={due}
              onChange={(event) => {
                setDue(Number(event.detail.value));
                setCursor(undefined);
              }}
            >
              <Text className="pill">{["全部进度", "到期复习", "尚未练习"][due]} ▾</Text>
            </Picker>
            <Action
              secondary={!archived}
              onClick={() => {
                setArchived(!archived);
                setCursor(undefined);
              }}
            >
              {archived ? "查看使用中" : "查看已归档"}
            </Action>
          </View>
          <Input
            className="input"
            value={tagDraft}
            onInput={(event) => setTagDraft(event.detail.value)}
            placeholder="按标签筛选（可选）"
            onConfirm={(event) => {
              setTag(event.detail.value);
              setCursor(undefined);
            }}
          />
        </>
      )}
      <Notice text={resource.error} />
      {resource.data?.items.map((item) => (
        <Card key={item.id} title={item.title}>
          <Paragraph>{item.meaning}</Paragraph>
          {item.tags.map((value) => (
            <Text className="pill" key={value}>
              {value}
            </Text>
          ))}
          <Action secondary onClick={() => void navigate("item", { id: item.id, type })}>
            查看与编辑
          </Action>
        </Card>
      ))}
      {!resource.loading && !resource.data?.items.length && (
        <Empty text="暂时没有匹配内容。可以手动添加，或从原文分析中收藏。" />
      )}
      {resource.loading && <Empty text="正在读取学习库…" />}
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
        刷新学习库
      </Action>
    </Screen>
  );
}

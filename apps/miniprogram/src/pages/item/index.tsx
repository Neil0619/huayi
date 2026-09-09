import { useState, useSyncExternalStore } from "react";
import { useRouter } from "@tarojs/taro";
import { Input, Text, Textarea } from "@tarojs/components";
import { useAction, useResource } from "../../components/hooks";
import {
  Action,
  Card,
  Notice,
  Paragraph,
  Screen,
  confirmAction,
  contentLabel,
  contentMeaning,
  navigate,
} from "../../components/ui";
import { ItemEditor } from "../../components/item-editor";
import { learningApi } from "../../services/api";
import { session } from "../../services/session";

export default function Item() {
  const account = useSyncExternalStore(session.subscribe, session.getSnapshot).account;
  return <ItemContent key={account?.id ?? "signed-out"} />;
}

function ItemContent() {
  const { id, type } = useRouter().params;
  const isWord = type === "word";
  const action = useAction();
  const [editing, setEditing] = useState(!id);
  const [message, setMessage] = useState("");
  const [headword, setHeadword] = useState("");
  const [notes, setNotes] = useState("");
  const [meaning, setMeaning] = useState("");
  const [source, setSource] = useState("");
  const [contextCursor, setContextCursor] = useState<string | undefined>();
  const resource = useResource(
    async () =>
      id
        ? isWord
          ? { kind: "word" as const, detail: await learningApi.word(id, contextCursor) }
          : { kind: "item" as const, detail: await learningApi.item(id) }
        : null,
    [contextCursor],
  );
  const data = resource.data;
  return (
    <Screen title={isWord ? "生词详情" : type === "sentence-pattern" ? "句型详情" : "表达详情"}>
      <Notice text={resource.error || action.error || message} />
      {data?.kind === "item" && (
        <Card title={contentLabel(data.detail.item.content)}>
          <Paragraph>{contentMeaning(data.detail.item.content)}</Paragraph>
          <Paragraph>{data.detail.item.content.usageZh}</Paragraph>
          <Text className="muted">
            {data.detail.schedule.dueAt
              ? `下次复习：${new Date(data.detail.schedule.dueAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}`
              : "尚未加入复习排期"}
          </Text>
          {data.detail.item.sourceExamples.map((example) => (
            <Card key={example.id} title="来源例句">
              <Paragraph>{example.sourceText}</Paragraph>
              {example.translationZh && <Paragraph>{example.translationZh}</Paragraph>}
            </Card>
          ))}
          {data.detail.recentPractice && (
            <Action
              secondary
              onClick={() =>
                void navigate("history", { id: data.detail.recentPractice?.sessionId ?? "" })
              }
            >
              查看最近练习
            </Action>
          )}
          {!data.detail.archivedAt && (
            <Action
              onClick={() =>
                void action.run(async () => {
                  const value = await learningApi.startPractice({
                    itemId: data.detail.item.id,
                    mode: "guided",
                  });
                  await navigate("practice", { id: value.id });
                })
              }
            >
              练习这个项目
            </Action>
          )}
          <Action secondary disabled={action.busy} onClick={() => setEditing(!editing)}>
            {editing ? "收起编辑" : "编辑内容"}
          </Action>
          <Action
            secondary
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                if (
                  !(await confirmAction(
                    data.detail.archivedAt ? "恢复学习项目" : "归档学习项目",
                    "学习记录仍会保留，归档项目不进入日常队列。",
                  ))
                )
                  return;
                await learningApi.archiveItem(
                  data.detail.item.id,
                  data.detail.item.revision,
                  !!data.detail.archivedAt,
                );
                await resource.reload();
              })
            }
          >
            {data.detail.archivedAt ? "恢复项目" : "归档项目"}
          </Action>
        </Card>
      )}
      {!isWord && editing && (
        <ItemEditor
          key={data?.kind === "item" ? data.detail.item.id : "new"}
          type={type === "sentence-pattern" ? "sentence-pattern" : "expression"}
          busy={action.busy || (!!id && data?.kind !== "item")}
          {...(data?.kind === "item"
            ? { initial: data.detail.item.content, initialTags: data.detail.item.tags }
            : {})}
          onSave={(content, tags) =>
            void action.run(async () => {
              const item = data?.kind === "item" ? data.detail.item : null;
              const input = { content, tags, systemAttributes: item?.systemAttributes ?? [] };
              const result = item
                ? await learningApi.editItem(item.id, { ...input, expectedRevision: item.revision })
                : await learningApi.createItem(input);
              if (!id) await navigate("item", { id: result.item.id, type: type ?? "expression" });
              else {
                setEditing(false);
                await resource.reload();
              }
              setMessage("已保存。");
            })
          }
        />
      )}
      {data?.kind === "word" && (
        <Card title={data.detail.word.headword}>
          <Paragraph>{data.detail.word.notes ?? "暂无笔记"}</Paragraph>
          <Action
            secondary
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await learningApi.archiveWord(
                  data.detail.word.id,
                  data.detail.word.revision,
                  !data.detail.archivedAt,
                );
                await resource.reload();
              })
            }
          >
            {data.detail.archivedAt ? "恢复生词" : "归档生词"}
          </Action>
          {data.detail.contexts.items.map((context) => (
            <Card key={context.id} title={context.sourceTitle ?? "原文语境"}>
              <Paragraph>{context.sourceText}</Paragraph>
              <Paragraph>{context.contextualMeaningZh}</Paragraph>
            </Card>
          ))}
          {data.detail.contexts.nextCursor && (
            <Action
              secondary
              onClick={() => setContextCursor(data.detail.contexts.nextCursor ?? undefined)}
            >
              更多语境
            </Action>
          )}
          <Action
            secondary
            onClick={() => {
              setNotes(data.detail.word.notes ?? "");
              setEditing(true);
            }}
          >
            编辑笔记
          </Action>
        </Card>
      )}
      {isWord && editing && (
        <Card title={id ? "编辑笔记" : "手动添加生词"}>
          {!id && (
            <>
              <Text className="field-label">英文单词</Text>
              <Input
                className="input"
                value={headword}
                maxlength={200}
                onInput={(event) => setHeadword(event.detail.value)}
              />
              <Text className="field-label">中文释义（可选）</Text>
              <Input
                className="input"
                value={meaning}
                maxlength={2000}
                onInput={(event) => setMeaning(event.detail.value)}
              />
              <Text className="field-label">来源原句（可选）</Text>
              <Textarea
                className="textarea"
                autoHeight
                value={source}
                maxlength={2000}
                onInput={(event) => setSource(event.detail.value)}
              />
            </>
          )}
          <Text className="field-label">笔记</Text>
          <Textarea
            className="textarea"
            autoHeight
            value={notes}
            maxlength={4000}
            onInput={(event) => setNotes(event.detail.value)}
          />
          <Action
            disabled={action.busy || (!!id && data?.kind !== "word") || (!id && !headword.trim())}
            onClick={() =>
              void action.run(async () => {
                if (data?.kind === "word") {
                  await learningApi.editWord(data.detail.word.id, data.detail.word.revision, notes);
                  setEditing(false);
                  await resource.reload();
                } else {
                  const result = await learningApi.createWord({
                    headword,
                    ...(notes.trim() ? { notes: notes.trim() } : {}),
                    ...(meaning.trim() || source.trim()
                      ? {
                          context: {
                            ...(meaning.trim() ? { contextualMeaningZh: meaning.trim() } : {}),
                            ...(source.trim() ? { sourceText: source.trim() } : {}),
                          },
                        }
                      : {}),
                  });
                  await navigate("item", { id: result.word.id, type: "word" });
                }
                setMessage("已保存。");
              })
            }
          >
            保存
          </Action>
        </Card>
      )}
      {id && (
        <Action secondary onClick={() => void resource.reload()}>
          刷新服务器内容
        </Action>
      )}
    </Screen>
  );
}

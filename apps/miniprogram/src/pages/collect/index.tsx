import { useRef, useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { Input, Picker, Text, Textarea, View } from "@tarojs/components";
import { useAction } from "../../components/hooks";
import { Action, Card, Notice, Screen, navigate } from "../../components/ui";
import { learningApi } from "../../services/api";
import { localStore } from "../../services/storage";
import { session } from "../../services/session";
import { sameCollectDraft, saveCaptureDraft } from "../../services/capture-save";

const kinds = ["phrase", "sentence", "passage"] as const;
export default function Collect() {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<(typeof kinds)[number]>("sentence");
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [details, setDetails] = useState(false);
  const editRevision = useRef(0);
  const currentDraft = useRef({ text, kind, title, context });
  currentDraft.current = { text, kind, title, context };
  const clearEditor = () => {
    setText("");
    setKind("sentence");
    setTitle("");
    setContext("");
  };
  const action = useAction();
  useDidShow(() => {
    void action.run(async () => {
      const revision = editRevision.current;
      await session.ensure();
      if (revision !== editRevision.current) return;
      const saved = localStore.get("collect-draft");
      if (
        typeof saved === "object" &&
        saved !== null &&
        "text" in saved &&
        typeof saved.text === "string"
      ) {
        setText(saved.text);
        setTitle("title" in saved && typeof saved.title === "string" ? saved.title : "");
        setContext("context" in saved && typeof saved.context === "string" ? saved.context : "");
        setKind(
          "kind" in saved &&
            (saved.kind === "phrase" || saved.kind === "sentence" || saved.kind === "passage")
            ? saved.kind
            : "sentence",
        );
      } else clearEditor();
    });
  });
  const draft = (
    values: Partial<{ text: string; title: string; context: string; kind: typeof kind }>,
  ) => {
    editRevision.current++;
    currentDraft.current = { ...currentDraft.current, ...values };
    localStore.set("collect-draft", currentDraft.current);
  };
  const save = (analyze: boolean) =>
    action.run(async () => {
      const snapshot = { text, kind, title, context };
      const capture = await saveCaptureDraft(learningApi, localStore, {
        sourceText: text,
        kind,
        title,
        context,
      });
      if (sameCollectDraft(currentDraft.current, snapshot)) clearEditor();
      await navigate("analysis", { captureId: capture.id, ...(analyze ? { analyze: "yes" } : {}) });
    });
  return (
    <Screen title="粘贴原文" subtitle="先留下，再理解。保存本身不会调用模型。">
      <Notice text={action.error} />
      <Card>
        <View className="row">
          <Picker
            range={["表达 / 短语", "单句", "段落"]}
            value={kinds.indexOf(kind)}
            onChange={(event) => {
              const value = kinds[Number(event.detail.value)] ?? "sentence";
              setKind(value);
              draft({ kind: value });
            }}
          >
            <Text className="pill">
              {kind === "phrase" ? "表达 / 短语" : kind === "sentence" ? "单句" : "段落"} ▾
            </Text>
          </Picker>
          <Text className="muted">{text.length} / 2000</Text>
        </View>
        <Textarea
          className="textarea"
          value={text}
          maxlength={-1}
          autoHeight
          adjustPosition
          cursorSpacing={24}
          placeholder="输入或粘贴英文原文…"
          onInput={(event) => {
            setText(event.detail.value);
            draft({ text: event.detail.value });
          }}
        />
        {text.trim().length > 2000 && (
          <Notice text="原文超过 2000 字符，已完整保存在本机。请缩短后保存。" />
        )}
        <Action
          secondary
          onClick={() =>
            void action.run(async () => {
              const value = (await Taro.getClipboardData()).data;
              setText(value);
              draft({ text: value });
            })
          }
        >
          从剪贴板粘贴
        </Action>
        <Action secondary onClick={() => setDetails(!details)}>
          {details ? "收起补充信息" : "补充标题与上下文（可选）"}
        </Action>
        {details && (
          <>
            <Text className="field-label">标题</Text>
            <Input
              className="input"
              value={title}
              maxlength={500}
              onInput={(event) => {
                setTitle(event.detail.value);
                draft({ title: event.detail.value });
              }}
            />
            <Text className="field-label">上下文</Text>
            <Textarea
              className="textarea"
              value={context}
              maxlength={1000}
              autoHeight
              onInput={(event) => {
                setContext(event.detail.value);
                draft({ context: event.detail.value });
              }}
            />
          </>
        )}
      </Card>
      <Action
        disabled={action.busy || !text.trim() || text.trim().length > 2000}
        onClick={() => void save(true)}
      >
        保存并分析
      </Action>
      <Action
        secondary
        disabled={action.busy || !text.trim() || text.trim().length > 2000}
        onClick={() => void save(false)}
      >
        保存到收集箱
      </Action>
    </Screen>
  );
}

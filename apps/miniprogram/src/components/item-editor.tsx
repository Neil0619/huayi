import { useState } from "react";
import { Input, Text, Textarea, View } from "@tarojs/components";
import type { LearningItemContent } from "@huayi/cloud-contracts";
import { Action, Card } from "./ui";

export function ItemEditor({
  initial,
  type,
  busy,
  onSave,
  initialTags = [],
}: {
  initial?: LearningItemContent;
  type: "expression" | "sentence-pattern";
  busy: boolean;
  initialTags?: string[];
  onSave(content: LearningItemContent, tags: string[]): void;
}) {
  const [text, setText] = useState(
    initial?.type === "expression" ? initial.text : (initial?.template ?? ""),
  );
  const [meaning, setMeaning] = useState(
    initial?.type === "expression" ? initial.meaningZh : (initial?.functionZh ?? ""),
  );
  const [usage, setUsage] = useState(initial?.usageZh ?? "");
  const [tags, setTags] = useState(initialTags.join("，"));
  const [slotDescriptions, setSlotDescriptions] = useState<Record<string, string>>(
    initial?.type === "sentence_pattern"
      ? Object.fromEntries(initial.slots.map((slot) => [slot.name, slot.descriptionZh]))
      : {},
  );
  const names = [
    ...new Set(
      [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_-]{0,39})\}/gu)].map((match) => match[1] ?? ""),
    ),
  ];
  const save = () => {
    const common = { usageZh: usage.trim() };
    const content: LearningItemContent =
      type === "expression"
        ? {
            type: "expression",
            text: text.trim(),
            meaningZh: meaning.trim(),
            ...common,
            ...(initial?.type === "expression" && initial.register
              ? { register: initial.register }
              : {}),
          }
        : {
            type: "sentence_pattern",
            template: text.trim(),
            functionZh: meaning.trim(),
            slots: names.map((name) => ({
              name,
              descriptionZh: slotDescriptions[name]?.trim() ?? "",
            })),
            ...common,
          };
    onSave(
      content,
      tags
        .split(/[,，]/u)
        .map((tag) => tag.trim())
        .filter(Boolean),
    );
  };
  return (
    <Card title={initial ? "编辑内容" : "手动添加"}>
      <Text className="field-label">{type === "expression" ? "英文表达" : "句型模板"}</Text>
      <Textarea
        className="textarea"
        autoHeight
        maxlength={500}
        value={text}
        onInput={(event) => setText(event.detail.value)}
      />
      {type === "sentence-pattern" && (
        <>
          <Text className="muted">
            {"可替换位置用花括号标出，如 It takes {someone} {time} to {doSomething}。"}
          </Text>
          {names.map((name) => (
            <View key={name}>
              <Text className="field-label">{name} 的含义</Text>
              <Input
                className="input"
                value={slotDescriptions[name] ?? ""}
                maxlength={500}
                onInput={(event) =>
                  setSlotDescriptions((values) => ({ ...values, [name]: event.detail.value }))
                }
              />
            </View>
          ))}
        </>
      )}
      <Text className="field-label">{type === "expression" ? "中文含义" : "表达功能"}</Text>
      <Textarea
        className="textarea"
        autoHeight
        maxlength={4000}
        value={meaning}
        onInput={(event) => setMeaning(event.detail.value)}
      />
      <Text className="field-label">使用说明</Text>
      <Textarea
        className="textarea"
        autoHeight
        maxlength={4000}
        value={usage}
        onInput={(event) => setUsage(event.detail.value)}
      />
      <Text className="field-label">标签（以逗号分隔，可选）</Text>
      <Input className="input" value={tags} onInput={(event) => setTags(event.detail.value)} />
      <Action disabled={busy || !text.trim() || !meaning.trim() || !usage.trim()} onClick={save}>
        保存到学习库
      </Action>
    </Card>
  );
}

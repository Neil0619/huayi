import { useState } from "react";
import { useRouter } from "@tarojs/taro";
import { Text, Textarea, View } from "@tarojs/components";
import {
  Action,
  Card,
  Notice,
  Paragraph,
  Screen,
  contentLabel,
  navigate,
} from "../../components/ui";
import { TaskView } from "../../components/task-view";
import { PracticeRating } from "../../components/practice-rating";
import { usePractice } from "../../components/use-practice";

export default function Practice() {
  const params = useRouter().params;
  const controller = usePractice(params.id, params.taskId);
  const [selected, setSelected] = useState(
    (params.items ?? "").split(",").filter(Boolean).slice(0, 3),
  );
  const { value, task, action, resource } = controller;
  const labels = Object.fromEntries(
    (resource.data?.items.items ?? []).map((detail) => [
      detail.item.id,
      contentLabel(detail.item.content),
    ]),
  );
  const rounds = value?.turns.filter((turn) => turn.role === "user").length ?? 0;
  const canAnswer =
    value &&
    value.status === "active" &&
    !task.active &&
    value.workspace?.phase !== "paused" &&
    (value.type !== "dialogue" || rounds < 5);
  return (
    <Screen
      title={
        value?.type === "sentence-creation"
          ? value.workspace?.mode === "free"
            ? "自由造句"
            : "引导造句"
          : "情境对话"
      }
      subtitle="输入先保留在当前设备，提交后同步到你的学习记录。"
    >
      <Notice text={resource.error || action.error} />
      {controller.answerTooLong && (
        <Notice
          text={`输入超过 4000 字符，已完整保存在本机。${
            value?.workspace?.phase === "paused"
              ? "请先继续练习，再缩短后提交。"
              : "请缩短后提交、同步或暂停练习。"
          }`}
        />
      )}
      <TaskView task={task} id={controller.taskId} />
      {!value && !task.active && (
        <Card title="选择 1—3 个学习项目">
          <Paragraph>对话将围绕这些项目展开，包含角色、目标和 3—5 轮练习。</Paragraph>
          {resource.data?.items.items.map((detail) => (
            <Action
              key={detail.item.id}
              secondary={!selected.includes(detail.item.id)}
              onClick={() =>
                setSelected((items) =>
                  items.includes(detail.item.id)
                    ? items.filter((id) => id !== detail.item.id)
                    : items.length < 3
                      ? [...items, detail.item.id]
                      : items,
                )
              }
            >
              {contentLabel(detail.item.content)}
            </Action>
          ))}
          <Action
            disabled={action.busy || !selected.length}
            onClick={() => void controller.startDialogue(selected)}
          >
            开始情境对话
          </Action>
        </Card>
      )}
      {value && (
        <>
          <Card title={value.items.map((item) => labels[item.itemId] ?? "学习项目").join(" · ")}>
            {value.dialoguePlan && (
              <>
                <Paragraph>你的角色：{value.dialoguePlan.roleZh}</Paragraph>
                <Paragraph>对话目标：{value.dialoguePlan.taskZh}</Paragraph>
                <Paragraph>完成条件：{value.dialoguePlan.endConditionZh}</Paragraph>
                <Text className="pill">已完成 {rounds} / 5 轮</Text>
              </>
            )}
            {value.prompt && <Paragraph>{value.prompt}</Paragraph>}
            {value.pendingGeneration === "sentence-prompt" && !task.active && (
              <>
                <Action disabled={action.busy} onClick={() => void controller.generate()}>
                  生成引导题目
                </Action>
                <Action
                  secondary
                  disabled={action.busy || controller.answerTooLong}
                  onClick={() => void controller.control("free")}
                >
                  切换自由造句
                </Action>
              </>
            )}
          </Card>
          {value.turns.map((turn) => (
            <View
              className={turn.role === "user" ? "message-user" : "message-assistant"}
              key={turn.id}
            >
              <Text className="muted">{turn.role === "user" ? "我" : "对话伙伴"}</Text>
              <Paragraph>{turn.content}</Paragraph>
            </View>
          ))}
          {value.attempts?.map((attempt) => (
            <Card key={attempt.id} title="我的句子">
              <Paragraph>{attempt.answer}</Paragraph>
              {attempt.feedback && (
                <>
                  <Text className="field-label">反馈</Text>
                  <Paragraph>{attempt.feedback}</Paragraph>
                </>
              )}
            </Card>
          ))}
          {canAnswer && (
            <Card title={value.type === "dialogue" ? "回应对话伙伴" : "试着写一个自己的句子"}>
              <Textarea
                className="textarea"
                autoHeight
                adjustPosition
                cursorSpacing={28}
                value={controller.answer}
                maxlength={-1}
                disabled={action.busy}
                onInput={(event) => controller.changeAnswer(event.detail.value)}
                onBlur={() => void controller.syncDraft()}
                placeholder="用英文写下你的想法…"
              />
              <Text className="muted">{controller.answer.length} / 4000 · 草稿保存在本机</Text>
              <Action
                disabled={
                  action.busy || !canAnswer || !controller.answer.trim() || controller.answerTooLong
                }
                onClick={() => void controller.submit()}
              >
                提交并获取反馈
              </Action>
            </Card>
          )}
          {!task.active &&
            value.type === "dialogue" &&
            rounds >= 3 &&
            value.status !== "completed" && (
              <Action disabled={action.busy} onClick={() => void controller.finish()}>
                结束对话并查看总结
              </Action>
            )}
          {!task.active &&
            ((value.type === "sentence-creation" &&
              value.attempts?.at(-1) &&
              !value.attempts.at(-1)?.feedback) ||
              (value.type === "dialogue" && value.pendingGeneration === "assistant-turn")) && (
              <Action secondary disabled={action.busy} onClick={() => void controller.retry()}>
                重试生成反馈
              </Action>
            )}
          {value.finalFeedback && (
            <Card title="本次反馈">
              <Paragraph>{value.finalFeedback}</Paragraph>
              {value.itemFeedbacks?.map((feedback) => (
                <View key={feedback.itemId}>
                  <Text className="field-label">{labels[feedback.itemId] ?? "学习项目"}</Text>
                  <Paragraph>{feedback.feedback}</Paragraph>
                </View>
              ))}
            </Card>
          )}
          <PracticeRating
            key={value.id}
            value={value}
            itemLabels={labels}
            onUpdate={controller.install}
          />
          {value.workspace && value.status === "active" && !task.active && (
            <Action
              secondary
              disabled={
                action.busy || (controller.answerTooLong && value.workspace.phase !== "paused")
              }
              onClick={() =>
                void controller.control(value.workspace?.phase === "paused" ? "resume" : "pause")
              }
            >
              {value.workspace.phase === "paused" ? "继续练习" : "暂存并暂停"}
            </Action>
          )}
          {value.workspace?.phase === "paused" && (
            <Paragraph>练习已暂停，点击继续后可以接着作答。</Paragraph>
          )}
        </>
      )}
      <Action secondary onClick={() => void resource.reload()}>
        刷新练习状态
      </Action>
      <Action secondary onClick={() => void navigate("history")}>
        练习历史
      </Action>
    </Screen>
  );
}

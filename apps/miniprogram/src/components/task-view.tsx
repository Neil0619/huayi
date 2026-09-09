import { useEffect, useRef, useState } from "react";
import { useDidHide, useDidShow } from "@tarojs/taro";
import type { LearningTaskPayload, LearningTaskSnapshot } from "@huayi/cloud-contracts";
import { cancelTask, watchTask } from "../services/tasks";
import { errorText, MiniError } from "../services/errors";
import { Action, Card, Notice, Paragraph, confirmAction } from "./ui";
import { useAction } from "./hooks";

export function useTask(id: string | null, onPayload: (payload: LearningTaskPayload) => void) {
  const [snapshot, setSnapshot] = useState<LearningTaskSnapshot | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [visible, setVisible] = useState(true);
  const [retry, setRetry] = useState(0);
  const callback = useRef(onPayload);
  callback.current = onPayload;
  useDidHide(() => setVisible(false));
  useDidShow(() => setVisible(true));
  useEffect(() => {
    if (!id || !visible) return;
    setPreview("");
    setError("");
    let lastPayload = "";
    const deliver = (payload: LearningTaskPayload) => {
      if (payload.type === "analysis.preview" || payload.type === "practice.preview")
        setPreview((text) => (text + payload.text).slice(0, 16_000));
      const key = JSON.stringify(payload);
      if (key !== lastPayload) {
        lastPayload = key;
        callback.current(payload);
      }
    };
    return watchTask(id, {
      onEvent: (event) => deliver(event.payload),
      onSnapshot: (value) => {
        setSnapshot(value);
        setError("");
        if (!["queued", "running", "cancelling"].includes(value.state)) {
          setPreview("");
          if (value.output) deliver(value.output);
          if (value.error) setError(errorText(new MiniError(value.error.code)));
        }
      },
      onError: (e) => setError(errorText(e)),
    });
  }, [id, visible, retry]);
  return {
    snapshot,
    preview,
    error,
    reconnect: () => setRetry((value) => value + 1),
    active:
      !!id &&
      (!snapshot ||
        snapshot.id !== id ||
        ["queued", "running", "cancelling"].includes(snapshot.state)),
  };
}
export function TaskView({ task, id }: { task: ReturnType<typeof useTask>; id: string | null }) {
  const action = useAction();
  if (!id) return null;
  return (
    <Card title={task.active ? "正在处理" : "任务状态"}>
      {task.active && (
        <Paragraph>
          {task.snapshot?.state === "queued"
            ? "已排队，可以离开页面，稍后回来继续。"
            : "正在生成内容，已提交的任务会保留。"}
        </Paragraph>
      )}
      {task.preview && <Paragraph>{task.preview}</Paragraph>}
      <Notice text={task.error || action.error} />
      {task.error && (
        <Action secondary onClick={task.reconnect}>
          重新读取任务状态
        </Action>
      )}
      {task.active && (
        <Action
          secondary
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              if (
                await confirmAction(
                  "停止当前任务",
                  "已产生的模型用量仍会计入额度。原文和草稿保留。",
                )
              )
                await cancelTask(id);
            })
          }
        >
          停止任务
        </Action>
      )}
    </Card>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import {
  analysisHttpRoutes,
  analysisRecordSchema,
  type AnalysisRecord,
  type LearningItemDetailResponse,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";
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
import { AnalysisBody } from "../../components/analysis-body";
import { TaskView, useTask } from "../../components/task-view";
import { learningApi, route, write } from "../../services/api";
import { localStore } from "../../services/storage";
import { listTasks, submitTask } from "../../services/tasks";
import { candidateDecisions } from "../../services/candidates";
import { session } from "../../services/session";

export default function Analysis() {
  const account = useSyncExternalStore(session.subscribe, session.getSnapshot).account;
  return <AnalysisContent key={account?.id ?? "signed-out"} />;
}

function AnalysisContent() {
  const params = useRouter().params;
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [capture, setCapture] = useState<StudyCaptureDetailResponse | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const action = useAction();
  const auto = useRef(false);
  const resource = useResource(async () => {
    const detail = params.captureId ? await learningApi.capture(params.captureId) : null;
    const id = params.id ?? detail?.latestAnalysis?.id;
    return {
      detail,
      analysis: id ? await learningApi.analysis(id) : null,
      tasks: await listTasks(),
    };
  });
  useEffect(() => {
    const value = resource.data;
    if (!value) return;
    setCapture(value.detail);
    if (value.analysis)
      setRecord((current) =>
        current && current.id === value.analysis?.id && current.revision > value.analysis.revision
          ? current
          : value.analysis,
      );
    const active = value.tasks.find(
      (task) =>
        task.kind === "capture-analysis" &&
        task.subjectId === value.detail?.capture.id &&
        ["queued", "running", "cancelling"].includes(task.state),
    );
    if (active) setTaskId(active.id);
  }, [resource.data]);
  const task = useTask(taskId, (payload) => {
    if (payload.type === "analysis.completed") {
      setRecord((current) =>
        current?.id === payload.analysis.id && current.revision > payload.analysis.revision
          ? current
          : payload.analysis,
      );
      setMessage("分析完成，选择想收藏的表达和句型。");
    }
  });
  const start = async (retry = false) => {
    if (!capture) return;
    const current = await learningApi.capture(capture.capture.id);
    setCapture(current);
    const existing = (await listTasks()).find(
      (job) =>
        job.kind === "capture-analysis" &&
        job.subjectId === current.capture.id &&
        ["queued", "running", "cancelling"].includes(job.state),
    );
    if (existing) {
      setTaskId(existing.id);
      return;
    }
    if (current.activeAnalysisRequest) {
      setMessage("已有分析正在处理，请刷新收集箱读取结果。");
      return;
    }
    if (retry && task.snapshot && ["failed", "cancelled"].includes(task.snapshot.state))
      localStore.remove(`write:task:capture:${current.capture.id}`);
    const result = await submitTask(`capture:${current.capture.id}`, {
      version: 2,
      kind: "capture-analysis",
      captureId: current.capture.id,
      input: {
        expectedRevision: current.capture.revision,
        intent: current.latestAnalysis ? "reanalysis" : "initial",
      },
    });
    setTaskId(result.id);
  };
  useEffect(() => {
    if (capture && params.analyze === "yes" && !auto.current) {
      auto.current = true;
      if (!capture.latestAnalysis) void action.run(() => start());
    }
  }, [capture]);
  const save = () =>
    action.run(async () => {
      if (!record) return;
      const library: LearningItemDetailResponse[] = [];
      for (const archived of [false, true]) {
        let cursor: string | undefined;
        do {
          const page = await learningApi.items({ archived, limit: 100, cursor });
          library.push(...page.items);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      }
      const confirmations = candidateDecisions(record, chosen, library);
      const merged = confirmations.filter((value) => value.decision.startsWith("merge:"));
      if (
        merged.length &&
        !(await confirmAction(
          "已有相同学习内容",
          `${merged.length} 个候选已在学习库中。确认后将原文补充到已有项目，保留原来的练习排期与归档状态。`,
        ))
      )
        return;
      const result = await learningApi.confirm(record.id, {
        analysisRevision: record.revision,
        confirmations,
      });
      setRecord(result.analysis);
      setSaved(result.results.map((value) => value.item.id));
      setChosen([]);
      setMessage("已收藏到学习库，可以立即开始练习。");
    });
  return (
    <Screen
      title="理解这段英文"
      subtitle={
        record?.source.title ?? capture?.capture.title ?? "读懂原句，再选择值得练习的内容。"
      }
    >
      <Notice text={resource.error || action.error || message} />
      <Card title="原文">
        <Paragraph>{record?.sourceText ?? capture?.capture.sourceText ?? "正在读取…"}</Paragraph>
        {capture?.capture.userContext && <Paragraph>{capture.capture.userContext}</Paragraph>}
      </Card>
      <TaskView id={taskId} task={task} />
      {capture && !task.active && (
        <Action
          secondary
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              if (record && !(await confirmAction("重新分析", "将使用当前额度重新分析这段原文。")))
                return;
              await start(true);
            })
          }
        >
          {record ? "重新分析" : "分析原文"}
        </Action>
      )}
      {record && (
        <>
          <AnalysisBody record={record} />
          <Text className="card-title">
            {record.reviewState === "reviewed" ? "已整理的候选" : "想留下哪些表达？"}
          </Text>
          {record.candidates.map((candidate) => (
            <View className={chosen.includes(candidate.id) ? "selected" : ""} key={candidate.id}>
              <Card title={contentLabel(candidate.payload)}>
                <Paragraph>{contentMeaning(candidate.payload)}</Paragraph>
                <Paragraph>{candidate.payload.usageZh}</Paragraph>
                {record.reviewState === "pendingReview" && (
                  <Action
                    secondary
                    onClick={() =>
                      setChosen((values) =>
                        values.includes(candidate.id)
                          ? values.filter((id) => id !== candidate.id)
                          : [...values, candidate.id],
                      )
                    }
                  >
                    {chosen.includes(candidate.id) ? "已选择 · 取消" : "选择收藏"}
                  </Action>
                )}
              </Card>
            </View>
          ))}
          <View className="sticky">
            <Action disabled={action.busy || !chosen.length} onClick={() => void save()}>
              收藏所选（{chosen.length}）
            </Action>
          </View>
          {record.reviewState === "pendingReview" && (
            <Action
              secondary
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  setRecord(
                    await write(
                      route(analysisHttpRoutes.process, record.id),
                      analysisRecordSchema,
                      { expectedRevision: record.revision, outcome: "nothing-to-save" },
                      "POST",
                      record.revision,
                    ),
                  );
                  setMessage("本次整理已完成。");
                })
              }
            >
              没有需要收藏的，完成整理
            </Action>
          )}
        </>
      )}
      {saved[0] && (
        <Action
          onClick={() =>
            void action.run(async () => {
              const practice = await learningApi.startPractice({
                itemId: saved[0] ?? "",
                mode: "guided",
              });
              await navigate("practice", { id: practice.id });
            })
          }
        >
          立即练习
        </Action>
      )}
      <Action secondary onClick={() => void resource.reload()}>
        刷新原文与分析状态
      </Action>
    </Screen>
  );
}

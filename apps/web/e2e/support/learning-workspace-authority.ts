import type { Page, Route } from "@playwright/test";
import {
  analysisRecordSchema,
  contractFixtures,
  confirmCandidatesRequestSchema,
  confirmCandidatesResponseSchema,
  learningTaskCommandSchema,
  practiceSessionResponseSchema,
  studyCaptureCreateResponseSchema,
  type AnalysisRecord,
  type LearningTaskPayload,
  type LearningTaskSnapshot,
  type PracticeSession,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";
import { createCloudBrowserAuthority } from "./cloud-browser-authority.js";
import { cloudCors } from "./cloud-browser-authority-request.js";

const date = "2026-09-05T00:00:00.000Z";
const source = analysisRecordSchema.parse(contractFixtures.analysis);
const learning =
  confirmCandidatesResponseSchema.parse(contractFixtures.confirmCandidatesResponse).results[0] ??
  (() => {
    throw new Error("Missing learning fixture");
  })();
const queueItem = {
  id: learning.item.id,
  content: learning.item.content,
  systemAttributes: learning.item.systemAttributes,
  tags: learning.item.tags,
  type: learning.item.type,
};
const schedule = { consecutiveMastered: 0, dueAt: null, level: -1 as const };
export function createLearningWorkspaceAuthority() {
  const base = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  const captures: StudyCaptureDetailResponse[] = [];
  const analyses: AnalysisRecord[] = [];
  const tasks: LearningTaskSnapshot[] = [];
  const keys = new Map<string, LearningTaskSnapshot>();
  let session: PracticeSession | null = null;
  let learned = false;
  let calls = 0;
  let ratings = 0;
  const json = (route: Route, value: unknown, status = 200) =>
    route.fulfill({
      status,
      headers: cloudCors(route.request().headers().origin) ?? {},
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  const complete = () => {
    for (const task of tasks.filter(
      (value) => value.state === "running" && value.kind === "capture-analysis",
    )) {
      const detail = captures.find((value) => value.capture.id === task.subjectId);
      if (!detail) throw new Error("Missing capture");
      const second = detail.capture.sourceText.startsWith("At least");
      const translationZh = second ? "至少我们可以再试一次。" : "坦率地说，这很有效。";
      const record = analysisRecordSchema.parse({
        ...source,
        id: `analysis-${detail.capture.id}`,
        sourceText: detail.capture.sourceText,
        studyCaptureId: detail.capture.id,
        candidates: second
          ? source.candidates.map((candidate) => ({
              ...candidate,
              payload: {
                type: "expression",
                text: "at least",
                meaningZh: "至少",
                usageZh: "强调最低限度。",
              },
            }))
          : source.candidates,
        result:
          source.result.type === "phrase-analysis-v2"
            ? source.result
            : {
                ...source.result,
                overall: {
                  translationZh,
                  understandingZh: second
                    ? "说话者提出仍然可以采取的行动。"
                    : "说话者直接肯定效果。",
                },
                sentences: source.result.sentences.map((value) => ({
                  ...value,
                  sourceText: detail.capture.sourceText,
                  translationZh,
                  ...(second
                    ? {
                        grammar: [{ label: "情态动词", explanationZh: "can 表示可以采取的行动。" }],
                        structure: [
                          { label: "主干", explanationZh: "we can try again 描述可以再次尝试。" },
                        ],
                      }
                    : {}),
                })),
              },
      });
      analyses.unshift(record);
      detail.capture = {
        ...detail.capture,
        status: "analyzed",
        revision: detail.capture.revision + 1,
      };
      detail.latestAnalysis = {
        id: record.id,
        createdAt: date,
        reviewState: "pendingReview",
        revision: record.revision,
      };
      task.state = "completed";
      task.output = {
        type: "analysis.completed",
        analysis: record,
        quota: {
          availableMicroUsd: 900,
          limitMicroUsd: 1000,
          percentUsed: 10,
          periodEnd: "2026-10-01T00:00:00.000Z",
          periodStart: "2026-09-01T00:00:00.000Z",
          reservedMicroUsd: 0,
          usedMicroUsd: 100,
          warning: "available",
        },
      };
      task.cursor = 1;
    }
  };
  return {
    source: source.sourceText,
    complete,
    facts: () => ({ captures: captures.length, analyses: analyses.length, calls, ratings }),
    async install(page: Page) {
      await base.install(page);
      await page.route("https://api.huayi.invalid/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        if (request.method() === "OPTIONS") return route.fallback();
        const body = request.postData()
          ? (JSON.parse(request.postData() ?? "{}") as Record<string, unknown>)
          : {};
        if (path === "/v2/study-captures" && request.method() === "POST") {
          const capture = {
            captureCount: 1,
            createdAt: date,
            firstCapturedAt: date,
            id: `capture-${captures.length + 1}`,
            kind: "sentence" as const,
            lastCapturedAt: date,
            normalizedTextHash: "a".repeat(64),
            revision: 1,
            sourceText: String(body.sourceText),
            status: "pending" as const,
            updatedAt: date,
          };
          captures.unshift({ capture, activeAnalysisRequest: null, latestAnalysis: null });
          return json(
            route,
            studyCaptureCreateResponseSchema.parse({
              capture,
              outcome: "created",
              undo: { captureId: capture.id, expectedRevision: capture.revision },
            }),
            201,
          );
        }
        if (path === "/v1/study-captures")
          return json(route, {
            items: captures.filter(
              (value) =>
                !url.searchParams.has("status") ||
                value.capture.status === url.searchParams.get("status"),
            ),
            nextCursor: null,
          });
        if (/^\/v1\/study-captures\//u.test(path)) {
          const detail = captures.find((value) => path.endsWith(value.capture.id));
          if (detail) return json(route, detail);
        }
        if (path === "/v1/analyses")
          return json(route, {
            items: analyses.filter((value) => value.reviewState === "pendingReview"),
            nextCursor: null,
          });
        if (/candidates:confirm$/u.test(path)) {
          const record = analyses.find((value) => path.includes(value.id));
          if (!record) throw new Error("Missing analysis");
          confirmCandidatesRequestSchema.parse(body);
          record.reviewState = "reviewed";
          record.revision += 1;
          learned = true;
          return json(
            route,
            confirmCandidatesResponseSchema.parse({
              ...contractFixtures.confirmCandidatesResponse,
              analysis: record,
            }),
          );
        }
        if (/^\/v1\/analyses\//u.test(path)) {
          const record = analyses.find((value) => path.endsWith(value.id));
          if (record) return json(route, record);
        }
        if (path === "/v2/learning-tasks" && request.method() === "POST") {
          const command = learningTaskCommandSchema.parse(body);
          const key = request.headers()["idempotency-key"] ?? "";
          const previous = keys.get(key);
          if (previous) return json(route, previous, 202);
          const task: LearningTaskSnapshot = {
            version: 2,
            id: `task-${tasks.length + 1}`,
            kind: command.kind,
            subjectId:
              command.kind === "capture-analysis" ? command.captureId : (session?.id ?? null),
            state: "running",
            cursor: 0,
            createdAt: date,
            updatedAt: date,
            error: null,
            output: null,
            timings: {},
          };
          if (command.kind === "capture-analysis") {
            calls += 1;
            const detail = captures.find((value) => value.capture.id === command.captureId);
            if (detail) detail.capture.status = "analyzing";
          }
          if (command.kind === "sentence-submit" && session) {
            calls += 1;
            session = practiceSessionResponseSchema.parse({
              ...session,
              revision: session.revision + 1,
              status: "completed",
              attempts: [
                {
                  id: "attempt-1",
                  itemIds: session.items.map((value) => value.itemId),
                  answer: command.input.answer,
                  submittedAt: date,
                  feedback: "表达准确，场景自然。",
                },
              ],
              finalFeedback: "表达准确，场景自然。",
            });
            task.state = "completed";
            task.output = { type: "practice.updated", session };
            task.cursor = 1;
          }
          tasks.unshift(task);
          keys.set(key, task);
          return json(route, task, 202);
        }
        if (path === "/v2/learning-tasks") return json(route, tasks);
        if (/^\/v2\/learning-tasks\//u.test(path)) {
          const task = tasks.find((value) => path.includes(`/${value.id}`));
          if (!task) throw new Error("Missing task");
          if (path.endsWith("/cancel")) {
            task.state = "cancelled";
            return json(route, task);
          }
          if (path.endsWith("/events")) {
            if (task.state === "running") await new Promise((resolve) => setTimeout(resolve, 100));
            const payload: LearningTaskPayload = task.output ?? {
              type: "analysis.preview",
              requestId: task.id,
              section: "overall",
              text: "这里先理解句子的含义，结果正在逐步生成。",
            };
            const cursor = task.state === "completed" ? 1 : 0;
            const event =
              cursor > Number(url.searchParams.get("cursor") ?? 0)
                ? `event: learning-task\nid: 1\ndata: ${JSON.stringify({ version: 2, taskId: task.id, cursor: 1, payload })}\n\n`
                : "";
            return route.fulfill({
              status: 200,
              headers: cloudCors(request.headers().origin) ?? {},
              contentType: "text/event-stream",
              body: event + `event: task-status\ndata: ${JSON.stringify(task)}\n\n`,
            });
          }
          return json(route, task);
        }
        if (path === "/v1/practice/daily-queue")
          return json(route, {
            completedToday: ratings,
            currentSession: null,
            currentItems: [],
            dailyGoal: 5,
            date: "2026-09-05",
            items: learned ? [{ item: queueItem, schedule }] : [],
            timezone: "UTC",
          });
        if (path.startsWith("/v1/learning-items/"))
          return json(route, {
            archivedAt: null,
            hasPracticeHistory: ratings > 0,
            item: learning.item,
            recentPractice: null,
            schedule,
          });
        if (path.endsWith("/ratings") && session) {
          ratings += 1;
          session = practiceSessionResponseSchema.parse({
            ...session,
            revision: session.revision + 1,
            items: session.items.map((value) => ({
              ...value,
              rating: "mastered",
              scheduleAfter: {
                consecutiveMastered: 1,
                dueAt: "2026-09-06T00:00:00.000Z",
                lastRating: "mastered",
                level: 0,
              },
            })),
          });
          return json(route, session);
        }
        if (path === "/v2/practice-workspace/start") {
          session = practiceSessionResponseSchema.parse({
            id: "practice-1",
            type: "sentence-creation",
            status: "active",
            prompt: `请使用 ${learning.item.content.type === "expression" ? learning.item.content.text : learning.item.content.template} 写一个新句子。`,
            items: [{ itemId: learning.item.id, position: 0, scheduleBefore: schedule }],
            turns: [],
            revision: 1,
            createdAt: date,
            updatedAt: date,
            workspace: { mode: "free", phase: "active", draft: "", draftRevision: 0 },
          });
          return json(route, session);
        }
        if (path === "/v2/practice-workspace")
          return json(route, session && session.workspace?.phase !== "ended" ? [session] : []);
        if (path.startsWith("/v2/practice-workspace/") && session) {
          if (path.endsWith("/draft") || path.endsWith("/control"))
            session = practiceSessionResponseSchema.parse({
              ...session,
              workspace: {
                ...session.workspace,
                draft: body.draft ?? session.workspace?.draft ?? "",
                draftRevision: (session.workspace?.draftRevision ?? 0) + 1,
                phase:
                  body.action === "end" ? "ended" : body.action === "pause" ? "paused" : "active",
              },
            });
          return json(route, session);
        }
        return route.fallback();
      });
    },
  };
}

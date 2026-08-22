import type { Request, Route } from "@playwright/test";
import {
  canonicalKeyForContent,
  dailyPracticeQueueResponseSchema,
  deletePracticeSessionRequestSchema,
  deletePracticeSessionResponseSchema,
  learningItemDetailResponseSchema,
  listPracticeSessionsQuerySchema,
  practiceHistoryDetailResponseSchema,
  practiceHistoryListResponseSchema,
  practiceHistorySummarySchema,
  practiceSessionResponseSchema,
  type ApiError,
  type DailyPracticeQueueResponse,
  type LearningItemDetailResponse,
  type PracticeSession,
} from "@huayi/cloud-contracts";

import { cloudQueryObject, cloudRequestBody } from "./cloud-browser-authority-request.js";

interface Hooks {
  json(route: Route, status: number, body: unknown): Promise<void>;
  record(request: Request, proof: "read" | "write-valid"): void;
  reject(
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: "read" | "write-invalid" | "write-valid",
  ): Promise<void>;
  writeProof(request: Request, revision?: number): string | null;
}

const now = "2026-08-13T10:00:00.000Z";
const completedAt = "2026-08-13T10:30:00.000Z";
const sessionId = "practice-history-dialogue";
const newSchedule = { consecutiveMastered: 0, dueAt: null, level: -1 } as const;
const masteredSchedule = {
  consecutiveMastered: 1,
  dueAt: "2026-08-14T10:30:00.000Z",
  lastRating: "mastered" as const,
  level: 0,
};
const effortfulSchedule = {
  consecutiveMastered: 0,
  dueAt: "2026-08-14T10:30:00.000Z",
  lastRating: "effortful" as const,
  level: 0,
};
const itemOneContent = {
  meaningZh: "完全坦率地说",
  register: "spoken" as const,
  text: "to be completely frank",
  type: "expression" as const,
  usageZh: "用于直接而坦率地表达观点。",
};
const itemTwoContent = {
  functionZh: "建议某个行动值得进行",
  slots: [{ descriptionZh: "要采取的行动", name: "action" }],
  template: "It is worth {action}",
  type: "sentence_pattern" as const,
  usageZh: "用于提出经过权衡的行动建议。",
};
const queueItems: DailyPracticeQueueResponse["items"] = [
  {
    item: {
      content: itemOneContent,
      id: "practice-item-1",
      systemAttributes: ["spoken"],
      tags: ["conversation"],
      type: "expression",
    },
    schedule: masteredSchedule,
  },
  {
    item: {
      content: itemTwoContent,
      id: "practice-item-2",
      systemAttributes: ["writing"],
      tags: ["planning"],
      type: "sentence-pattern",
    },
    schedule: effortfulSchedule,
  },
];

function learningDetail(index: 0 | 1): LearningItemDetailResponse {
  const content = index === 0 ? itemOneContent : itemTwoContent;
  const id = `practice-item-${index + 1}`;
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: {
      canonicalKey: canonicalKeyForContent(content),
      content,
      createdAt: now,
      id,
      revision: 1,
      sourceExamples: [],
      systemAttributes: queueItems[index]?.item.systemAttributes ?? [],
      tags: queueItems[index]?.item.tags ?? [],
      type: index === 0 ? "expression" : "sentence-pattern",
      updatedAt: now,
    },
    recentPractice: null,
    schedule: index === 0 ? masteredSchedule : effortfulSchedule,
  });
}

function completedDialogue(): PracticeSession {
  const contents = [
    "You are discussing a project plan with a colleague.",
    "To be completely frank, I would test the risky assumption first.",
    "That sounds sensible. Which assumption creates the greatest risk?",
    "It is worth checking whether users understand the workflow.",
    "Agreed. We can measure that before committing to the launch.",
    "To be completely frank, that evidence would make the plan stronger.",
    "Then we have a concrete next step and a clear success condition.",
  ];
  return practiceSessionResponseSchema.parse({
    createdAt: now,
    dialoguePlan: {
      endConditionZh: "共同确认下一步验证计划。",
      roleZh: "项目同事",
      taskZh: "讨论方案是否具备足够证据。",
    },
    finalFeedback: "The dialogue used both targets accurately and stayed concise.",
    id: sessionId,
    itemFeedbacks: [
      { feedback: "坦率表达自然且位置恰当。", itemId: "practice-item-1" },
      { feedback: "建议句型准确覆盖了行动。", itemId: "practice-item-2" },
    ],
    items: [
      {
        itemId: "practice-item-1",
        position: 0,
        rating: "mastered",
        scheduleAfter: masteredSchedule,
        scheduleBefore: newSchedule,
      },
      {
        itemId: "practice-item-2",
        position: 1,
        rating: "effortful",
        scheduleAfter: effortfulSchedule,
        scheduleBefore: newSchedule,
      },
    ],
    prompt: "Use both learning items while discussing a project plan.",
    revision: 8,
    status: "completed",
    turns: contents.map((content, ordinal) => ({
      content,
      createdAt: now,
      id: `practice-history-turn-${ordinal}`,
      ordinal,
      role: ordinal % 2 === 0 ? "assistant" : "user",
    })),
    type: "dialogue",
    updatedAt: completedAt,
  });
}

export function createCloudBrowserPracticeHistoryAuthority() {
  const session = completedDialogue();
  let historyPresent = true;
  const replays = new Map<string, { hash: string; response: unknown }>();

  const handle = async (route: Route, hooks: Hooks): Promise<boolean> => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/practice/daily-queue" && request.method() === "GET") {
      hooks.record(request, "read");
      await hooks.json(
        route,
        200,
        dailyPracticeQueueResponseSchema.parse({
          currentItems: [],
          currentSession: null,
          dailyGoal: 2,
          date: "2026-08-13",
          items: queueItems,
          timezone: "Asia/Shanghai",
        }),
      );
      return true;
    }
    const item = /^\/v1\/learning-items\/(practice-item-[12])$/u.exec(url.pathname);
    if (item?.[1] !== undefined && request.method() === "GET") {
      hooks.record(request, "read");
      await hooks.json(route, 200, learningDetail(item[1] === "practice-item-1" ? 0 : 1));
      return true;
    }
    if (url.pathname === "/v1/practice/sessions" && request.method() === "GET") {
      const query = listPracticeSessionsQuerySchema.safeParse(cloudQueryObject(url));
      if (!query.success) {
        await hooks.reject(route, 400, "invalid_request", "read");
        return true;
      }
      const visible =
        historyPresent &&
        (query.data.type === undefined || query.data.type === session.type) &&
        (query.data.status === undefined || query.data.status === session.status);
      hooks.record(request, "read");
      await hooks.json(
        route,
        200,
        practiceHistoryListResponseSchema.parse({
          items: visible
            ? [
                practiceHistorySummarySchema.parse({
                  completedAt,
                  createdAt: session.createdAt,
                  id: session.id,
                  items: session.items.map(({ itemId, rating }) => ({ itemId, rating })),
                  revision: session.revision,
                  status: session.status,
                  type: session.type,
                  updatedAt: session.updatedAt,
                }),
              ]
            : [],
          nextCursor: null,
        }),
      );
      return true;
    }
    if (url.pathname === `/v1/practice/sessions/${sessionId}` && request.method() === "GET") {
      if (!historyPresent) {
        await hooks.reject(route, 404, "not_found", "read");
        return true;
      }
      hooks.record(request, "read");
      await hooks.json(
        route,
        200,
        practiceHistoryDetailResponseSchema.parse({
          completedAt,
          itemLabels: [
            { itemId: "practice-item-1", label: itemOneContent.text },
            { itemId: "practice-item-2", label: itemTwoContent.template },
          ],
          session,
        }),
      );
      return true;
    }
    if (url.pathname === `/v1/practice/sessions/${sessionId}` && request.method() === "DELETE") {
      const parsed = deletePracticeSessionRequestSchema.safeParse(cloudRequestBody(request));
      if (!parsed.success) {
        await hooks.reject(route, 400, "invalid_request");
        return true;
      }
      const key = hooks.writeProof(request, parsed.data.expectedRevision);
      if (key === null) {
        await hooks.reject(route, 403, "forbidden");
        return true;
      }
      const hash = JSON.stringify(parsed.data);
      const prior = replays.get(key);
      if (prior !== undefined) {
        if (prior.hash !== hash) {
          await hooks.reject(route, 409, "idempotency_conflict", "write-valid");
          return true;
        }
        hooks.record(request, "write-valid");
        await hooks.json(route, 200, structuredClone(prior.response));
        return true;
      }
      if (!historyPresent || parsed.data.expectedRevision !== session.revision) {
        await hooks.reject(route, 409, "revision_conflict", "write-valid");
        return true;
      }
      const response = deletePracticeSessionResponseSchema.parse({ deleted: true, id: sessionId });
      historyPresent = false;
      replays.set(key, { hash, response: structuredClone(response) });
      hooks.record(request, "write-valid");
      await hooks.json(route, 200, response);
      return true;
    }
    return false;
  };

  return { count: () => (historyPresent ? 1 : 0), handle };
}

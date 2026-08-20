import type { Request, Route } from "@playwright/test";
import {
  accountPreferencesResponseSchema,
  canonicalKeyForContent,
  dailyPracticeQueueResponseSchema,
  finishPracticeSessionRequestSchema,
  learningItemDetailResponseSchema,
  practiceRatingsRequestSchema,
  practiceSessionResponseSchema,
  quotaSummarySchema,
  startDialogueSessionRequestSchema,
  startSentenceSessionRequestSchema,
  submitDialogueTurnRequestSchema,
  submitPracticeAttemptRequestSchema,
  type ApiError,
  type DailyPracticeQueueResponse,
  type LearningItemDetailResponse,
  type PracticeSession,
} from "@huayi/cloud-contracts";

export type PracticeAuthoritySeed = "dialogue-practice" | "pending-sentence-practice";

interface Hooks {
  json(route: Route, status: number, body: unknown): Promise<void>;
  record(request: Request, proof: "read" | "write-valid"): void;
  reject(route: Route, status: number, code: ApiError["error"]["code"]): Promise<void>;
  writeProof(request: Request, revision?: number): string | null;
}

const now = "2026-08-13T10:00:00.000Z";
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
const schedule = { consecutiveMastered: 0, dueAt: null, level: -1 } as const;
const queueItems: DailyPracticeQueueResponse["items"] = [
  {
    item: {
      content: itemOneContent,
      id: "practice-item-1",
      systemAttributes: ["spoken"],
      tags: ["conversation"],
      type: "expression",
    },
    schedule,
  },
  {
    item: {
      content: itemTwoContent,
      id: "practice-item-2",
      systemAttributes: ["writing"],
      tags: ["planning"],
      type: "sentence-pattern",
    },
    schedule,
  },
];

function detail(index: 0 | 1): LearningItemDetailResponse {
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
      sourceExamples: [
        {
          id: `practice-source-${index + 1}`,
          sourceText:
            index === 0
              ? "To be completely frank, we need stronger evidence."
              : "It is worth testing the risky assumption first.",
          sourceType: "manual",
        },
      ],
      systemAttributes: queueItems[index]?.item.systemAttributes ?? [],
      tags: queueItems[index]?.item.tags ?? [],
      type: index === 0 ? "expression" : "sentence-pattern",
      updatedAt: now,
    },
    recentPractice: null,
    schedule,
  });
}

function sessionItem(itemId: string, position: number) {
  return { itemId, position, scheduleBefore: schedule };
}

function pendingSentence(): PracticeSession {
  return practiceSessionResponseSchema.parse({
    createdAt: now,
    id: "practice-session-sentence",
    items: [sessionItem("practice-item-1", 0)],
    pendingGeneration: "sentence-prompt",
    revision: 1,
    status: "awaiting-feedback",
    turns: [],
    type: "sentence-creation",
    updatedAt: now,
  });
}

function dialogueStart(): PracticeSession {
  return practiceSessionResponseSchema.parse({
    createdAt: now,
    dialoguePlan: {
      endConditionZh: "共同确认下一步验证计划。",
      roleZh: "项目同事",
      taskZh: "讨论方案是否具备足够证据。",
    },
    id: "practice-session-dialogue",
    items: [sessionItem("practice-item-1", 0), sessionItem("practice-item-2", 1)],
    prompt: "Use both learning items while discussing a project plan.",
    revision: 1,
    status: "active",
    turns: [
      {
        content: "You are discussing a project plan with a colleague.",
        createdAt: now,
        id: "dialogue-turn-0",
        ordinal: 0,
        role: "assistant",
      },
    ],
    type: "dialogue",
    updatedAt: now,
  });
}

function requestBody(request: Request): unknown {
  const body = request.postData();
  if (body === null) throw new TypeError("Practice request body is missing.");
  return JSON.parse(body) as unknown;
}

export function createCloudBrowserPracticeAuthority(seed: PracticeAuthoritySeed) {
  let providerCalls = 0;
  let session: PracticeSession | null =
    seed === "pending-sentence-practice" ? pendingSentence() : null;
  const replays = new Map<string, { hash: string; response: PracticeSession }>();

  const queue = () =>
    dailyPracticeQueueResponseSchema.parse({
      currentItems:
        session === null
          ? []
          : session.items.map((entry) =>
              queueItems.find((candidate) => candidate.item.id === entry.itemId),
            ),
      currentSession: session,
      dailyGoal: 2,
      date: "2026-08-13",
      items: queueItems,
      timezone: "Asia/Shanghai",
    });

  const mutate = async (
    route: Route,
    hooks: Hooks,
    parsed: { success: boolean; data?: Record<string, unknown> },
    revision: number | undefined,
    apply: () => PracticeSession,
  ) => {
    if (!parsed.success || parsed.data === undefined)
      return hooks.reject(route, 400, "invalid_request");
    const request = route.request();
    const key = hooks.writeProof(request, revision);
    if (key === null) return hooks.reject(route, 403, "forbidden");
    const path = new URL(request.url()).pathname;
    const hash = JSON.stringify(parsed.data);
    const prior = replays.get(`${path}\u0000${key}`);
    if (prior !== undefined) {
      if (prior.hash !== hash) return hooks.reject(route, 409, "idempotency_conflict");
      hooks.record(request, "write-valid");
      return hooks.json(route, 200, prior.response);
    }
    if (revision !== undefined && session?.revision !== revision) {
      return hooks.reject(route, 409, "revision_conflict");
    }
    const response = practiceSessionResponseSchema.parse(apply());
    session = response;
    replays.set(`${path}\u0000${key}`, { hash, response: structuredClone(response) });
    hooks.record(request, "write-valid");
    return hooks.json(route, 200, response);
  };

  const handle = async (route: Route, hooks: Hooks): Promise<boolean> => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/v1/account/preferences" && request.method() === "GET") {
      hooks.record(request, "read");
      await hooks.json(
        route,
        200,
        accountPreferencesResponseSchema.parse({
          cloudWordCopyMode: "enabled",
          dailyGoal: 2,
          extensionQueryModelMode: "platform",
          revision: 1,
          studyCaptureMode: "manual",
          timezone: "Asia/Shanghai",
          updatedAt: now,
        }),
      );
      return true;
    }
    if (path === "/v1/quota" && request.method() === "GET") {
      hooks.record(request, "read");
      await hooks.json(
        route,
        200,
        quotaSummarySchema.parse({
          availableMicroUsd: 1_000_000 - providerCalls * 100_000,
          limitMicroUsd: 1_000_000,
          percentUsed: providerCalls * 10,
          periodEnd: "2026-09-01T00:00:00.000Z",
          periodStart: "2026-08-01T00:00:00.000Z",
          reservedMicroUsd: 0,
          usedMicroUsd: providerCalls * 100_000,
          warning: "available",
        }),
      );
      return true;
    }
    if (path === "/v1/practice/daily-queue" && request.method() === "GET") {
      hooks.record(request, "read");
      await hooks.json(route, 200, queue());
      return true;
    }
    const item = /^\/v1\/learning-items\/(practice-item-[12])$/u.exec(path);
    if (item?.[1] !== undefined && request.method() === "GET") {
      hooks.record(request, "read");
      await hooks.json(route, 200, detail(item[1] === "practice-item-1" ? 0 : 1));
      return true;
    }
    if (path === "/v1/practice/sentence-sessions" && request.method() === "POST") {
      const parsed = startSentenceSessionRequestSchema.safeParse(requestBody(request));
      await mutate(route, hooks, parsed, undefined, () => {
        providerCalls += 1;
        return {
          ...pendingSentence(),
          pendingGeneration: undefined,
          prompt: "Use the expression to challenge a plan constructively.",
          revision: 2,
          status: "active",
        };
      });
      return true;
    }
    if (path === "/v1/practice/dialogue-sessions" && request.method() === "POST") {
      const parsed = startDialogueSessionRequestSchema.safeParse(requestBody(request));
      await mutate(route, hooks, parsed, undefined, () => {
        providerCalls += 1;
        return dialogueStart();
      });
      return true;
    }
    const attempt = /^\/v1\/practice\/sessions\/([^/]+)\/attempts$/u.exec(path);
    if (attempt?.[1] !== undefined && request.method() === "POST") {
      const parsed = submitPracticeAttemptRequestSchema.safeParse(requestBody(request));
      await mutate(
        route,
        hooks,
        parsed,
        parsed.success ? parsed.data.expectedRevision : undefined,
        () => {
          providerCalls += 1;
          return {
            ...session,
            attempts: [
              {
                answer: parsed.success ? parsed.data.answer : "",
                feedback: "表达自然，并正确使用了目标表达。",
                id: "practice-attempt-1",
                itemIds: ["practice-item-1"],
                submittedAt: now,
              },
            ],
            finalFeedback: "表达自然，并正确使用了目标表达。",
            revision: 3,
            status: "completed",
          } as PracticeSession;
        },
      );
      return true;
    }
    const turn = /^\/v1\/practice\/sessions\/([^/]+)\/turns$/u.exec(path);
    if (turn?.[1] !== undefined && request.method() === "POST") {
      const parsed = submitDialogueTurnRequestSchema.safeParse(requestBody(request));
      await mutate(
        route,
        hooks,
        parsed,
        parsed.success ? parsed.data.expectedRevision : undefined,
        () => {
          providerCalls += 1;
          const turns = [...(session?.turns ?? [])];
          turns.push({
            content: parsed.success ? parsed.data.content : "",
            createdAt: now,
            id: `dialogue-turn-${turns.length}`,
            ordinal: turns.length,
            role: "user",
          });
          turns.push({
            content: `I understand. Let us examine point ${Math.ceil(turns.length / 2)}.`,
            createdAt: now,
            id: `dialogue-turn-${turns.length}`,
            ordinal: turns.length,
            role: "assistant",
          });
          return {
            ...session,
            revision: (session?.revision ?? 0) + 1,
            status: "active",
            turns,
          } as PracticeSession;
        },
      );
      return true;
    }
    const finish = /^\/v1\/practice\/sessions\/([^/]+)\/finish$/u.exec(path);
    if (finish?.[1] !== undefined && request.method() === "POST") {
      const parsed = finishPracticeSessionRequestSchema.safeParse(requestBody(request));
      await mutate(
        route,
        hooks,
        parsed,
        parsed.success ? parsed.data.expectedRevision : undefined,
        () => {
          providerCalls += 1;
          return {
            ...session,
            finalFeedback: "你完成了三轮对话，并自然覆盖了两个学习项。",
            itemFeedbacks: [
              { feedback: "直接表达观点时使用自然。", itemId: "practice-item-1" },
              { feedback: "建议行动时结构准确。", itemId: "practice-item-2" },
            ],
            revision: (session?.revision ?? 0) + 1,
            status: "completed",
          } as PracticeSession;
        },
      );
      return true;
    }
    const ratings = /^\/v1\/practice\/sessions\/([^/]+)\/ratings$/u.exec(path);
    if (ratings?.[1] !== undefined && request.method() === "POST") {
      const parsed = practiceRatingsRequestSchema.safeParse(requestBody(request));
      await mutate(
        route,
        hooks,
        parsed,
        parsed.success ? parsed.data.expectedRevision : undefined,
        () =>
          ({
            ...session,
            items: session?.items.map((entry) => {
              const rating = parsed.success
                ? parsed.data.ratings.find((candidate) => candidate.itemId === entry.itemId)?.rating
                : undefined;
              return rating === undefined
                ? entry
                : {
                    ...entry,
                    rating,
                    scheduleAfter: {
                      consecutiveMastered: rating === "mastered" ? 1 : 0,
                      dueAt: "2026-08-14T10:00:00.000Z",
                      lastRating: rating,
                      level: 0,
                    },
                  };
            }),
            revision: (session?.revision ?? 0) + 1,
          }) as PracticeSession,
      );
      return true;
    }
    return false;
  };

  return { handle, providerCalls: () => providerCalls };
}

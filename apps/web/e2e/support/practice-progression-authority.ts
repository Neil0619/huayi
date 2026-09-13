import type { Page, Route } from "@playwright/test";
import {
  contractFixtures,
  confirmCandidatesResponseSchema,
  dailyPracticeQueueResponseSchema,
  learningItemDetailResponseSchema,
  learningTaskCommandSchema,
  learningTaskSnapshotSchema,
  practiceRatingsRequestSchema,
  practiceSessionResponseSchema,
  practiceWorkspaceControlSchema,
  practiceWorkspaceDraftSchema,
  practiceWorkspaceStartSchema,
  type PracticeSession,
} from "@huayi/cloud-contracts";
import { createCloudBrowserAuthority } from "./cloud-browser-authority.js";
import { createProgressionTeaching } from "./practice-progression-teaching.js";
import { cloudCors } from "./cloud-browser-authority-request.js";

const date = "2026-09-12T08:00:00.000Z";
const source = confirmCandidatesResponseSchema.parse(contractFixtures.confirmCandidatesResponse)
  .results[0]?.item;
if (!source) throw new Error("Missing learning fixture");
const items = ["at least", "to be frank"].map((text, index) => ({
  item: {
    ...source,
    canonicalKey: text,
    id: `daily-item-${index + 1}`,
    type: "expression" as const,
    content: {
      type: "expression" as const,
      text,
      meaningZh: index === 0 ? "至少" : "坦率地说",
      usageZh: "用于日常沟通。",
    },
  },
  schedule: { consecutiveMastered: 0, dueAt: null, level: -1 as const },
}));
for (const entry of items)
  learningItemDetailResponseSchema.parse({
    ...entry,
    archivedAt: null,
    hasPracticeHistory: false,
    recentPractice: null,
  });
const queueItems = items.map(({ item, schedule }) => ({
  item: {
    id: item.id,
    content: item.content,
    systemAttributes: item.systemAttributes,
    tags: item.tags,
    type: item.type,
  },
  schedule,
}));

/** Offline HTTP authority, including durable creation replay and a lost response after commit. */
export function createPracticeProgressionAuthority() {
  const base = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  const sessions = new Map<string, PracticeSession>();
  const teaching = createProgressionTeaching();
  const replays = new Map<string, { body: string; value: unknown }>();
  const jobs = new Map<string, ReturnType<typeof learningTaskSnapshotSchema.parse>>();
  let loseNextStart = false;
  let ratings = 0;
  let generations = 0;
  const get = (id: string) => {
    const session = sessions.get(id);
    if (!session) throw new Error(`Missing offline practice ${id}`);
    return session;
  };
  const save = (input: unknown) => {
    const result = practiceSessionResponseSchema.parse(input);
    sessions.set(result.id, result);
    return result;
  };
  const json = (route: Route, value: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: cloudCors(route.request().headers().origin) ?? {},
      body: JSON.stringify(value),
    });
  return {
    loseNextStartResponse() {
      loseNextStart = true;
    },
    facts: () => ({ ratings, generations, sessions: [...sessions.values()] }),
    async install(page: Page) {
      await base.install(page);
      await page.route("https://api.huayi.invalid/**", async (route) => {
        const request = route.request();
        if (request.method() === "OPTIONS") return route.fallback();
        const url = new URL(request.url());
        const path = url.pathname;
        const body: unknown = request.postData() ? JSON.parse(request.postData() ?? "{}") : {};
        if (path === "/v2/practice/daily-queue") {
          const rated = new Set(
            [...sessions.values()].flatMap((session) =>
              session.items.filter((item) => item.rating).map((item) => item.itemId),
            ),
          );
          const current =
            [...sessions.values()].find(
              (session) =>
                session.workspace?.phase === "active" && session.items.some((item) => !item.rating),
            ) ?? null;
          return json(
            route,
            dailyPracticeQueueResponseSchema.parse({
              date: "2026-09-12",
              timezone: "Asia/Shanghai",
              dailyGoal: 5,
              completedToday: rated.size,
              currentSession: current,
              currentItems: current
                ? queueItems.filter((entry) =>
                    current.items.some((item) => item.itemId === entry.item.id),
                  )
                : [],
              items: queueItems.filter((entry) => !rated.has(entry.item.id)),
            }),
          );
        }
        if (path.startsWith("/v1/learning-items/daily-item-")) {
          const entry = items.find((item) => path.endsWith(item.item.id));
          return json(
            route,
            learningItemDetailResponseSchema.parse({
              ...entry,
              archivedAt: null,
              hasPracticeHistory: false,
              recentPractice: null,
            }),
          );
        }
        if (path === "/v2/practice-workspace")
          return json(
            route,
            [...sessions.values()].filter((session) =>
              ["active", "paused"].includes(session.workspace?.phase ?? "active"),
            ),
          );
        const teachingId = /^\/v2\/practice\/sessions\/(session-[0-9]+)\/teaching$/u.exec(
          path,
        )?.[1];
        if (teachingId && request.method() === "GET")
          return json(route, teaching.detail(get(teachingId)));
        const workspace =
          /^\/v2\/practice-workspace\/(session-[0-9]+)(?:\/(draft|control))?$/u.exec(path);
        if (workspace?.[1] && request.method() === "GET") return json(route, get(workspace[1]));
        if (path === "/v2/learning-tasks" && request.method() === "GET")
          return json(route, [...jobs.values()]);
        const taskId = /^\/v2\/learning-tasks\/([^/]+)/u.exec(path)?.[1];
        if (taskId) {
          const job = jobs.get(taskId);
          if (!job) throw new Error("Missing task");
          if (!path.endsWith("/events")) return json(route, job);
          return route.fulfill({
            headers: cloudCors(request.headers().origin) ?? {},
            contentType: "text/event-stream",
            body: `event: learning-task\nid: 1\ndata: ${JSON.stringify({ version: 2, taskId, cursor: 1, payload: job.output })}\n\nevent: task-status\ndata: ${JSON.stringify(job)}\n\n`,
          });
        }
        const ratingId = /^\/v2\/practice\/sessions\/([^/]+)\/ratings$/u.exec(path)?.[1];
        if (!(
          workspace?.[1] ||
          ratingId ||
          path === "/v2/practice-workspace/start" ||
          path === "/v2/learning-tasks"
        ))
          return route.fallback();
        if (request.method() !== "POST" || !request.headers()["x-csrf-token"])
          throw new Error("Missing mutation proof");
        const key = request.headers()["idempotency-key"];
        if (!key && workspace?.[2] !== "draft") throw new Error("Missing operation identity");
        const replayKey = `${path}:${key}`;
        const previous = key ? replays.get(replayKey) : undefined;
        if (previous) {
          if (previous.body !== JSON.stringify(body))
            throw new Error("Conflicting operation identity");
          const stored =
            path === "/v2/practice-workspace/start"
              ? get(practiceSessionResponseSchema.parse(previous.value).id)
              : previous.value;
          return json(route, stored);
        }
        let result: unknown;
        if (path === "/v2/practice-workspace/start") {
          const input = practiceWorkspaceStartSchema.parse(body);
          result = save({
            id: `session-${sessions.size + 1}`,
            type: "sentence-creation",
            status: "awaiting-feedback",
            pendingGeneration: "sentence-prompt",
            items: [{ itemId: input.itemId, position: 0, scheduleBefore: items[0]?.schedule }],
            revision: 1,
            turns: [],
            createdAt: date,
            updatedAt: date,
            workspace: {
              phase: "active",
              mode: input.mode,
              draft: "",
              draftRevision: 0,
              controlRevision: 0,
            },
          });
          const content = items.find((entry) => entry.item.id === input.itemId)?.item.content;
          if (!content) throw new Error("Missing teaching target");
          teaching.start(practiceSessionResponseSchema.parse(result), input, content);
        } else if (workspace?.[1]) {
          const session = get(workspace[1]);
          if (workspace[2] === "draft") {
            const input = practiceWorkspaceDraftSchema.parse(body);
            result = save({
              ...session,
              workspace: {
                ...session.workspace,
                draft: input.draft,
                draftRevision: input.expectedDraftRevision + 1,
              },
            });
          } else {
            const input = practiceWorkspaceControlSchema.parse(body);
            if (
              input.expectedRevision !== session.revision ||
              input.expectedControlRevision !== (session.workspace?.controlRevision ?? 0)
            )
              throw new Error("Stale navigation revision");
            result = save({
              ...session,
              revision: session.revision + 1,
              workspace: {
                ...session.workspace,
                phase:
                  input.action === "end" ? "ended" : input.action === "pause" ? "paused" : "active",
                draft: input.draft ?? session.workspace?.draft ?? "",
                controlRevision: (session.workspace?.controlRevision ?? 0) + 1,
              },
            });
          }
        } else if (ratingId) {
          const input = practiceRatingsRequestSchema.parse(body);
          const session = get(ratingId);
          if (input.expectedRevision !== session.revision) throw new Error("Stale rating revision");
          ratings += 1;
          result = save({
            ...session,
            revision: session.revision + 1,
            items: session.items.map((item) => ({
              ...item,
              rating: input.ratings.find((rating) => rating.itemId === item.itemId)?.rating,
              scheduleAfter: {
                consecutiveMastered: 1,
                dueAt: "2026-09-15T08:00:00.000Z",
                level: 0,
              },
            })),
          });
        } else {
          const command = learningTaskCommandSchema.parse(body);
          if (
            (command.kind !== "sentence-start" && command.kind !== "sentence-submit") ||
            !command.sessionId
          )
            throw new Error("Unexpected generation");
          const session = get(command.sessionId);
          const updated = save(
            command.kind === "sentence-start"
              ? {
                  ...session,
                  pendingGeneration: undefined,
                  status: "active",
                  prompt: `说说你的安排，使用 ${items.find((entry) => entry.item.id === session.items[0]?.itemId)?.item.content.text}。`,
                  revision: session.revision + 1,
                }
              : {
                  ...session,
                  status: "completed",
                  revision: session.revision + 1,
                  finalFeedback: teaching.feedback(session),
                  attempts: [
                    {
                      id: `attempt-${session.id}`,
                      answer: command.input.answer,
                      itemIds: session.items.map((item) => item.itemId),
                      submittedAt: date,
                      feedback: teaching.feedback(session),
                    },
                  ],
                },
          );
          generations += 1;
          const job = learningTaskSnapshotSchema.parse({
            version: 2,
            id: `task-${jobs.size + 1}`,
            kind: command.kind,
            subjectId: session.id,
            state: "completed",
            cursor: 1,
            error: null,
            timings: {},
            createdAt: date,
            updatedAt: date,
            output: { type: "practice.updated", session: updated },
          });
          jobs.set(job.id, job);
          result = job;
        }
        if (key) replays.set(replayKey, { body: JSON.stringify(body), value: result });
        if (path === "/v2/practice-workspace/start" && loseNextStart) {
          loseNextStart = false;
          return route.abort("failed");
        }
        return json(route, result);
      });
    },
  };
}

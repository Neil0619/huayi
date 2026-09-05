import type { Request, Route } from "@playwright/test";
import {
  learningTaskCommandSchema,
  learningTaskEventSchema,
  learningTaskPayloadSchema,
  learningTaskSnapshotSchema,
  type ApiError,
  type LearningTaskCommand,
  type LearningTaskEvent,
  type LearningTaskSnapshot,
} from "@huayi/cloud-contracts";
import { cloudCors, cloudRequestBody } from "./cloud-browser-authority-request.js";

interface Hooks {
  dispatch(route: Route): Promise<void>;
  json(route: Route, status: number, body: unknown): Promise<void>;
  record(request: Request, proof: "read" | "write-valid"): void;
  reject(route: Route, status: number, code: ApiError["error"]["code"]): Promise<void>;
  writeProof(request: Request): string | null;
}

function operation(command: LearningTaskCommand): string {
  switch (command.kind) {
    case "capture-analysis":
      return `/v1/study-captures/${command.captureId}/analyses:stream`;
    case "analysis":
      return "/v1/analyses:stream";
    case "duplicate-suggestions":
      return `/v1/learning-items/${command.itemId}/duplicate-suggestions`;
    case "sentence-start":
      return "/v2/practice/sentence-sessions";
    case "sentence-submit":
      return `/v2/practice/sessions/${command.sessionId}/attempts`;
    case "dialogue-start":
      return "/v2/practice/dialogue-sessions";
    case "dialogue-turn":
      return `/v2/practice/sessions/${command.sessionId}/turns`;
    case "dialogue-finish":
      return `/v2/practice/sessions/${command.sessionId}/finish`;
    default:
      throw new Error(`Unsupported offline task fixture: ${command.kind}`);
  }
}

export function createCloudBrowserTaskAuthority(hold = false) {
  const jobs = new Map<
    string,
    {
      command: LearningTaskCommand;
      request: Request;
      snapshot: LearningTaskSnapshot;
      events: LearningTaskEvent[];
    }
  >();
  const keys = new Map<string, { hash: string; id: string }>();
  const internalRequests = new WeakSet<Request>();
  const now = "2026-09-05T00:00:00.000Z";
  return {
    isInternal: (request: Request) => internalRequests.has(request),
    complete: () => {
      hold = false;
    },
    async handle(route: Route, hooks: Hooks): Promise<boolean> {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/v2/learning-tasks")) return false;
      if (url.pathname === "/v2/learning-tasks" && request.method() === "POST") {
        const parsed = learningTaskCommandSchema.safeParse(cloudRequestBody(request));
        const key = hooks.writeProof(request);
        if (!parsed.success || key === null) {
          await hooks.reject(route, 403, "forbidden");
          return true;
        }
        const hash = JSON.stringify(parsed.data);
        const previous = keys.get(key);
        if (previous && previous.hash !== hash) {
          await hooks.reject(route, 409, "idempotency_conflict");
          return true;
        }
        const command = parsed.data;
        const id = previous?.id ?? `learning-task-${jobs.size + 1}`;
        if (!previous) {
          const subjectId =
            "captureId" in command
              ? command.captureId
              : "itemId" in command
                ? command.itemId
                : "sessionId" in command
                  ? (command.sessionId ?? null)
                  : null;
          jobs.set(id, {
            command,
            request,
            events: [],
            snapshot: learningTaskSnapshotSchema.parse({
              version: 2,
              id,
              kind: command.kind,
              subjectId,
              state: "running",
              cursor: 0,
              createdAt: now,
              updatedAt: now,
              error: null,
              output: null,
              timings: {},
            }),
          });
          keys.set(key, { hash, id });
        }
        hooks.record(request, "write-valid");
        await hooks.json(route, 202, jobs.get(id)?.snapshot);
        return true;
      }
      if (request.method() !== "GET") {
        await hooks.reject(route, 400, "invalid_request");
        return true;
      }
      hooks.record(request, "read");
      if (url.pathname === "/v2/learning-tasks") {
        await hooks.json(
          route,
          200,
          [...jobs.values()].map((job) => job.snapshot),
        );
        return true;
      }
      const job = jobs.get(url.pathname.split("/")[3] ?? "");
      if (!job) {
        await hooks.reject(route, 404, "not_found");
        return true;
      }
      if (!url.pathname.endsWith("/events")) {
        await hooks.json(route, 200, job.snapshot);
        return true;
      }
      const append = (payload: unknown) => {
        const event = learningTaskEventSchema.parse({
          version: 2,
          taskId: job.snapshot.id,
          cursor: job.events.length + 1,
          payload,
        });
        job.events.push(event);
        job.snapshot.cursor = event.cursor;
      };
      if (job.snapshot.state === "running") {
        if (job.events.length === 0 && job.command.kind === "capture-analysis") {
          append({
            type: "analysis.preview",
            requestId: job.snapshot.id,
            section: "overall",
            text: "正在识别可复用表达。",
          });
        } else if (!hold) {
          // Reuse the existing deterministic domain authorities behind the task envelope.
          // This dispatch is in memory; request facts retain only real browser HTTP requests.
          const input = job.command.input;
          const headers = { ...job.request.headers() };
          if ("expectedRevision" in input && job.command.kind !== "duplicate-suggestions")
            headers["if-match"] = `"${input.expectedRevision}"`;
          const internal = new Proxy(job.request, {
            get(target, property) {
              if (property === "url") return () => new URL(operation(job.command), url.origin).href;
              if (property === "headers") return () => headers;
              if (property === "postData") return () => JSON.stringify(input);
              if (property === "postDataJSON") return () => input;
              const value = Reflect.get(target, property);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
          internalRequests.add(internal);
          const response = { status: 0, body: "", contentType: "" };
          const internalRoute = new Proxy(route, {
            get(target, property) {
              if (property === "request") return () => internal;
              if (property === "fulfill")
                return async (options: Parameters<Route["fulfill"]>[0]) => {
                  response.status = options?.status ?? 200;
                  response.body = String(options?.body ?? "");
                  response.contentType = options?.contentType ?? "";
                };
              const value = Reflect.get(target, property);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
          await hooks.dispatch(internalRoute);
          if (response.status !== 200)
            throw new Error(`Offline task domain rejected: ${response.status}`);
          const output = response.contentType.startsWith("text/event-stream")
            ? response.body
                .split("\n")
                .filter((line) => line.startsWith("data: "))
                .map((line) => learningTaskPayloadSchema.parse(JSON.parse(line.slice(6))))
                .find((event) => event.type === "analysis.completed")
            : learningTaskPayloadSchema.parse(
                job.command.kind === "duplicate-suggestions"
                  ? { type: "duplicates.completed", result: JSON.parse(response.body) }
                  : { type: "practice.updated", session: JSON.parse(response.body) },
              );
          if (!output) throw new Error("Offline task has no completed output");
          append(output);
          job.snapshot = learningTaskSnapshotSchema.parse({
            ...job.snapshot,
            state: "completed",
            output,
          });
        }
      }
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      const body =
        job.events
          .filter((event) => event.cursor > cursor)
          .map(
            (event) =>
              `event: learning-task\nid: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join("") + `event: task-status\ndata: ${JSON.stringify(job.snapshot)}\n\n`;
      await route.fulfill({
        status: 200,
        headers: cloudCors(request.headers().origin) ?? {},
        contentType: "text/event-stream",
        body,
      });
      return true;
    },
  };
}

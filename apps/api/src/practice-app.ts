import {
  dailyPracticeQueueResponseSchema,
  dailyQueueQuerySchema,
  deletePracticeSessionRequestSchema,
  deletePracticeSessionResponseSchema,
  finishPracticeSessionRequestSchema,
  practiceHttpRoutes,
  practiceHttpRoutesV2,
  practiceHistoryDetailResponseSchema,
  practiceHistoryListResponseSchema,
  practiceRatingsRequestSchema,
  practiceSessionResponseSchema,
  retryDialogueAssistantRequestSchema,
  retryPracticeFeedbackRequestSchema,
  revisionWriteHeadersSchema,
  startDialogueSessionRequestSchema,
  startSentenceSessionRequestSchema,
  submitDialogueTurnRequestSchema,
  submitPracticeAttemptRequestSchema,
  listPracticeSessionsQuerySchema,
  writeHeadersSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

import { CloudFault } from "./cloud-fault.js";
import type { DialoguePracticeModule } from "./dialogue-practice-module.js";
import type { PracticeModule } from "./practice-module.js";
import type { PracticeHistoryModule } from "./practice-history-module.js";
import { practiceResponsesV1 } from "./practice-v1-responses.js";

async function body(context: Context) {
  try {
    return await context.req.json();
  } catch {
    throw new CloudFault("invalid_request", "Expected JSON.");
  }
}

function createHeaders(context: Context) {
  const parsed = writeHeadersSchema.safeParse({
    "idempotency-key": context.req.header("idempotency-key"),
  });
  if (!parsed.success) throw new CloudFault("invalid_request", "Idempotency-Key is required.");
  return parsed.data["idempotency-key"];
}

function mutationHeaders(context: Context, expectedRevision: number) {
  const parsed = revisionWriteHeadersSchema.safeParse({
    "idempotency-key": context.req.header("idempotency-key"),
    "if-match": context.req.header("if-match"),
  });
  if (!parsed.success) {
    throw new CloudFault("invalid_request", "Idempotency-Key and If-Match are required.");
  }
  if (Number(parsed.data["if-match"].slice(1, -1)) !== expectedRevision) {
    throw new CloudFault("invalid_request", "If-Match must match expectedRevision.");
  }
  return parsed.data["idempotency-key"];
}

function param(context: Context, name: string) {
  const value = context.req.param(name);
  if (value === undefined) throw new CloudFault("invalid_request", "Route parameter missing.");
  return value;
}

interface PracticeAppOptions {
  authenticate(context: Context): Promise<string> | string;
  dialogueModule: DialoguePracticeModule;
  historyModule: PracticeHistoryModule;
  module: PracticeModule;
}

export function createPracticeApp(options: PracticeAppOptions) {
  const app = new Hono();
  app.route("/", createVersionedPracticeApp(options, "v1"));
  app.route("/", createVersionedPracticeApp(options, "v2"));
  return app;
}

function createVersionedPracticeApp(options: PracticeAppOptions, version: "v1" | "v2") {
  const routes = version === "v1" ? practiceHttpRoutes : practiceHttpRoutesV2;
  const responses =
    version === "v1"
      ? practiceResponsesV1
      : {
          dailyQueue: dailyPracticeQueueResponseSchema,
          historyDetail: practiceHistoryDetailResponseSchema,
          historyList: practiceHistoryListResponseSchema,
          session: practiceSessionResponseSchema,
        };
  const app = new Hono();
  app.get(routes.dailyQueue, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const query = dailyQueueQuerySchema.parse(context.req.query());
    return context.json(
      responses.dailyQueue.parse(await options.module.dailyQueue(ownerUserId, query)),
    );
  });
  app.post(routes.startSentence, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = startSentenceSessionRequestSchema.parse(await body(context));
    return context.json(
      responses.session.parse(
        await options.module.startSentence(ownerUserId, createHeaders(context), input),
      ),
      201,
    );
  });
  app.post(routes.startDialogue, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = startDialogueSessionRequestSchema.parse(await body(context));
    return context.json(
      responses.session.parse(
        await options.dialogueModule.startDialogue(ownerUserId, createHeaders(context), input),
      ),
      201,
    );
  });
  app.post(routes.submitTurn, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = submitDialogueTurnRequestSchema.parse(await body(context));
    return context.json(
      responses.session.parse(
        await options.dialogueModule.submitTurn(
          ownerUserId,
          param(context, "id"),
          mutationHeaders(context, input.expectedRevision),
          input,
        ),
      ),
    );
  });
  app.post(routes.retryAssistant, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = retryDialogueAssistantRequestSchema.parse(await body(context));
    return context.json(
      responses.session.parse(
        await options.dialogueModule.retryAssistant(
          ownerUserId,
          param(context, "id"),
          mutationHeaders(context, input.expectedRevision),
          input,
        ),
      ),
    );
  });
  app.post(routes.finish, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = finishPracticeSessionRequestSchema.parse(await body(context));
    return context.json(
      responses.session.parse(
        await options.dialogueModule.finish(
          ownerUserId,
          param(context, "id"),
          mutationHeaders(context, input.expectedRevision),
          input,
        ),
      ),
    );
  });
  app.post(routes.submitAttempt, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = submitPracticeAttemptRequestSchema.parse(await body(context));
    return context.json(
      responses.session.parse(
        await options.module.submitAttempt(
          ownerUserId,
          param(context, "id"),
          mutationHeaders(context, input.expectedRevision),
          input,
        ),
      ),
    );
  });
  app.post(routes.retryFeedback, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = retryPracticeFeedbackRequestSchema.parse(await body(context));
    return context.json(
      responses.session.parse(
        await options.module.retryFeedback(
          ownerUserId,
          param(context, "id"),
          param(context, "attemptId"),
          mutationHeaders(context, input.expectedRevision),
          input,
        ),
      ),
    );
  });
  app.post(routes.rate, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = practiceRatingsRequestSchema.parse(await body(context));
    return context.json(
      responses.session.parse(
        await options.module.rate(
          ownerUserId,
          param(context, "id"),
          mutationHeaders(context, input.expectedRevision),
          input,
        ),
      ),
    );
  });
  app.get(routes.historyList, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const query = listPracticeSessionsQuerySchema.parse(context.req.query());
    return context.json(
      responses.historyList.parse(await options.historyModule.list(ownerUserId, query)),
    );
  });
  app.get(routes.historyDetail, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const found = await options.historyModule.get(ownerUserId, param(context, "id"));
    if (found === null) throw new CloudFault("not_found", "Practice session not found.");
    return context.json(responses.historyDetail.parse(found));
  });
  app.delete(routes.historyDelete, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = deletePracticeSessionRequestSchema.parse(await body(context));
    return context.json(
      deletePracticeSessionResponseSchema.parse(
        await options.historyModule.delete(
          ownerUserId,
          param(context, "id"),
          mutationHeaders(context, input.expectedRevision),
          input,
        ),
      ),
    );
  });
  return app;
}

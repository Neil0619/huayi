import { createHash } from "node:crypto";

import {
  dailyPracticeQueueResponseSchema,
  dailyQueueQuerySchema,
  practiceRatingsRequestSchema,
  practiceSessionResponseSchema,
  retryPracticeFeedbackRequestSchema,
  startSentenceSessionRequestSchema,
  submitPracticeAttemptRequestSchema,
  type DailyPracticeQueueResponse,
  type PracticeSession,
} from "@huayi/cloud-contracts";

import type { ModelExecution } from "./model-execution.js";
import { CloudFault } from "./cloud-fault.js";
import type { PaidPracticeGenerator } from "./paid-practice-generator.js";

export type PracticeItem = DailyPracticeQueueResponse["items"][number];

export interface PracticeRepository {
  beginSentence(
    command: PracticeMutationCommand & {
      generationLeaseExpiresAt: string;
      generationLeaseToken: string;
      generationId: string;
      itemId: string;
      targetSessionId?: string;
    },
  ): Promise<PracticePromptClaim>;
  beginFeedbackRetry(
    command: PracticeMutationCommand & {
      attemptId: string;
      feedbackLeaseExpiresAt: string;
      feedbackLeaseToken: string;
      generationId: string;
    },
  ): Promise<PracticeFeedbackClaim>;
  completeFeedback(command: {
    attemptId: string;
    feedback: string;
    feedbackLeaseToken: string;
    generationId: string;
    idempotencyKey: string;
    now: string;
    ownerUserId: string;
    operation: "practice.attempt" | "practice.feedback-retry";
    requestHash: string;
    sessionId: string;
  }): Promise<PracticeSession>;
  completeSentencePrompt(
    command: PracticeMutationCommand & {
      generationId: string;
      generationLeaseToken: string;
      prompt: string;
    },
  ): Promise<PracticeSession>;
  dailyQueue(ownerUserId: string, now: string): Promise<DailyPracticeQueueResponse>;
  findPracticeItem(ownerUserId: string, itemId: string): Promise<PracticeItem | null>;
  releaseFeedbackLease(command: {
    attemptId: string;
    feedbackLeaseToken: string;
    now: string;
    ownerUserId: string;
    sessionId: string;
  }): Promise<void>;
  releaseSentencePromptLease(command: {
    generationLeaseToken: string;
    now: string;
    ownerUserId: string;
    sessionId: string;
  }): Promise<void>;
  rate(command: PracticeMutationCommand & { input: unknown }): Promise<PracticeSession>;
  recordAttempt(
    command: PracticeMutationCommand & {
      answer: string;
      attemptId: string;
      feedbackLeaseExpiresAt: string;
      feedbackLeaseToken: string;
      generationId: string;
    },
  ): Promise<PracticeFeedbackClaim>;
}

interface PracticeMutationCommand {
  expectedRevision?: number;
  idempotencyKey: string;
  now: string;
  ownerUserId: string;
  requestHash: string;
  sessionId: string;
}

type PracticeFeedbackClaim =
  | { claimed: false; item: PracticeItem; session: PracticeSession }
  | {
      claimed: true;
      generationId: string;
      item: PracticeItem;
      leaseToken: string;
      session: PracticeSession;
    };

type PracticePromptClaim =
  | { claimed: false; session: PracticeSession }
  | {
      claimed: true;
      generationId: string;
      item: PracticeItem;
      leaseToken: string;
      session: PracticeSession;
    };

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createPracticeModule(options: {
  generator: Pick<PaidPracticeGenerator, "generate">;
  id(): string;
  now(): Date;
  repository: PracticeRepository;
}) {
  const mutation = (
    ownerUserId: string,
    sessionId: string,
    idempotencyKey: string,
    input: unknown,
  ) => ({
    idempotencyKey,
    now: options.now().toISOString(),
    ownerUserId,
    requestHash: hash(input),
    sessionId,
  });

  const generateFeedback = async (
    claimed: PracticeFeedbackClaim,
    ownerUserId: string,
    sessionId: string,
    idempotencyKey: string,
    operation: "practice.attempt" | "practice.feedback-retry",
    requestHash: string,
    execution: ModelExecution,
  ) => {
    execution.onSession?.(claimed.session);
    if (!claimed.claimed) return practiceSessionResponseSchema.parse(claimed.session);
    const attempt = claimed.session.attempts?.at(-1);
    if (attempt === undefined) throw new CloudFault("invalid_request", "Practice attempt missing.");
    if (claimed.session.prompt === undefined) {
      throw new CloudFault("invalid_request", "Practice prompt missing.");
    }
    const generated = await options.generator.generate({
      ...execution,
      generationId: claimed.generationId,
      input: {
        answer: attempt.answer,
        itemContent: claimed.item.item.content,
        prompt: claimed.session.prompt,
      },
      kind: "sentence-feedback",
      leaseToken: claimed.leaseToken,
      ownerUserId,
    });
    if (generated === null) return practiceSessionResponseSchema.parse(claimed.session);
    if (generated.kind !== "sentence-feedback") {
      throw new CloudFault("invalid_request", "Practice feedback output is invalid.");
    }
    return practiceSessionResponseSchema.parse(
      await options.repository.completeFeedback({
        attemptId: attempt.id,
        feedback: generated.feedback,
        feedbackLeaseToken: claimed.leaseToken,
        generationId: claimed.generationId,
        idempotencyKey,
        now: options.now().toISOString(),
        ownerUserId,
        operation,
        requestHash,
        sessionId,
      }),
    );
  };

  return {
    async dailyQueue(ownerUserId: string, input: unknown) {
      dailyQueueQuerySchema.parse(input);
      return dailyPracticeQueueResponseSchema.parse(
        await options.repository.dailyQueue(ownerUserId, options.now().toISOString()),
      );
    },
    async rate(ownerUserId: string, sessionId: string, idempotencyKey: string, input: unknown) {
      const request = practiceRatingsRequestSchema.parse(input);
      return practiceSessionResponseSchema.parse(
        await options.repository.rate({
          ...mutation(ownerUserId, sessionId, idempotencyKey, request),
          expectedRevision: request.expectedRevision,
          input: request,
        }),
      );
    },
    async retryFeedback(
      ownerUserId: string,
      sessionId: string,
      attemptId: string,
      idempotencyKey: string,
      input: unknown,
      execution: ModelExecution = {},
    ) {
      const request = retryPracticeFeedbackRequestSchema.parse(input);
      const claimed = await options.repository.beginFeedbackRetry({
        ...mutation(ownerUserId, sessionId, idempotencyKey, request),
        attemptId,
        expectedRevision: request.expectedRevision,
        feedbackLeaseExpiresAt: new Date(options.now().getTime() + 120_000).toISOString(),
        feedbackLeaseToken: options.id(),
        generationId: options.id(),
      });
      return generateFeedback(
        claimed,
        ownerUserId,
        sessionId,
        idempotencyKey,
        "practice.feedback-retry",
        hash(request),
        execution,
      );
    },
    async startSentence(
      ownerUserId: string,
      idempotencyKey: string,
      input: unknown,
      execution: ModelExecution = {},
      targetSessionId?: string,
    ) {
      const request = startSentenceSessionRequestSchema.parse(input);
      const sessionId = options.id();
      const generationId = options.id();
      const command = mutation(ownerUserId, sessionId, idempotencyKey, request);
      const claimed = await options.repository.beginSentence({
        ...command,
        generationLeaseExpiresAt: new Date(options.now().getTime() + 120_000).toISOString(),
        generationLeaseToken: options.id(),
        generationId,
        itemId: request.itemId,
        ...(targetSessionId ? { targetSessionId } : {}),
      });
      execution.onSession?.(claimed.session);
      if (!claimed.claimed) return practiceSessionResponseSchema.parse(claimed.session);
      const generated = await options.generator.generate({
        ...execution,
        generationId: claimed.generationId,
        input: { itemContent: claimed.item.item.content },
        kind: "sentence-prompt",
        leaseToken: claimed.leaseToken,
        ownerUserId,
      });
      if (generated === null) return practiceSessionResponseSchema.parse(claimed.session);
      if (generated.kind !== "sentence-prompt") {
        throw new CloudFault("invalid_request", "Practice prompt output is invalid.");
      }
      return practiceSessionResponseSchema.parse(
        await options.repository.completeSentencePrompt({
          ...command,
          generationId: claimed.generationId,
          generationLeaseToken: claimed.leaseToken,
          prompt: generated.prompt,
          sessionId: claimed.session.id,
        }),
      );
    },
    async submitAttempt(
      ownerUserId: string,
      sessionId: string,
      idempotencyKey: string,
      input: unknown,
      execution: ModelExecution = {},
    ) {
      const request = submitPracticeAttemptRequestSchema.parse(input);
      const claimed = await options.repository.recordAttempt({
        ...mutation(ownerUserId, sessionId, idempotencyKey, request),
        answer: request.answer,
        attemptId: options.id(),
        expectedRevision: request.expectedRevision,
        feedbackLeaseExpiresAt: new Date(options.now().getTime() + 120_000).toISOString(),
        feedbackLeaseToken: options.id(),
        generationId: options.id(),
      });
      return generateFeedback(
        claimed,
        ownerUserId,
        sessionId,
        idempotencyKey,
        "practice.attempt",
        hash(request),
        execution,
      );
    },
  };
}

export type PracticeModule = ReturnType<typeof createPracticeModule>;
